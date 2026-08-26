import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { dropIsolatedDatabase } from "./helpers/postgres-database.js";
import {
  closeOptimizerPoliciesHarness,
  createOptimizerPoliciesHarness,
  optimizerPoliciesAuthorization,
  type OptimizerPoliciesHarness,
} from "./helpers/optimizer-policies-app.js";

let harness: OptimizerPoliciesHarness;

beforeAll(async () => {
  harness = await createOptimizerPoliciesHarness("ccpo_optimizer_policies_route");
});

afterAll(async () => {
  await closeOptimizerPoliciesHarness(harness);
  await dropIsolatedDatabase(harness?.database);
});

describe("POST /api/optimizer-policies", () => {
  it("creates a tenant-scoped draft risk policy without exposing tenant or secret fields", async () => {
    const response = await postPolicy(validPolicy("default risk budget"));

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      name: "default risk budget",
      objective: "maximize_expected_savings",
      max_downside_loss_cents: "500000",
      min_expected_savings_cents: "10000",
      max_utilization_gap_pct: "12.50",
      approval_threshold_cents: "250000",
      allowed_instruments: ["aws_compute_savings_plan"],
      config: { liquidity_penalty_bps: 100 },
      status: "draft",
    });
    expect(response.body).not.toMatch(/tenant_id|credential|password|secret|token/iu);
  });

  it("rejects unsupported fields, unsafe config, bad economics, duplicate names, and API keys", async () => {
    for (const payload of [
      { ...validPolicy("bad objective"), objective: "headline_savings" },
      { ...validPolicy("bad cents"), max_downside_loss_cents: "-1" },
      { ...validPolicy("bad utilization"), max_utilization_gap_pct: "100.01" },
      { ...validPolicy("bad instrument"), allowed_instruments: ["spot"] },
      { ...validPolicy("unsafe config"), config: { token: "x" } },
      { ...validPolicy("unknown"), unknown: true },
    ]) {
      const response = await postPolicy(payload);
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toEqual({
        code: "VALIDATION_ERROR",
        message: "Request is invalid.",
        details: [],
      });
    }

    await postPolicy(validPolicy("duplicate"));
    const duplicate = await postPolicy(validPolicy("duplicate"));
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error).toEqual({
      code: "OPTIMIZER_POLICY_CONFLICT",
      message: "Optimizer policy already exists.",
      details: [],
    });

    const denied = await postPolicy(validPolicy("api key denied"), {
      "x-api-key": harness.analystApiKey,
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("FORBIDDEN");
  });
});

describe("PATCH /api/optimizer-policies/{id}", () => {
  it("updates draft fields, activates the policy, then freezes economic fields", async () => {
    const created = await postPolicy(validPolicy("patchable"));

    const patched = await patchPolicy(created.json().id, {
      min_expected_savings_cents: "20000",
      max_utilization_gap_pct: "9.25",
      config: { liquidity_penalty_bps: 250, approval_rules: [{ over_cents: "1000000" }] },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({
      id: created.json().id,
      min_expected_savings_cents: "20000",
      max_utilization_gap_pct: "9.25",
      status: "draft",
    });

    const activated = await patchPolicy(created.json().id, { status: "active" });
    expect(activated.statusCode).toBe(200);
    expect(activated.json().status).toBe("active");

    const frozen = await patchPolicy(created.json().id, { max_downside_loss_cents: "1" });
    expect(frozen.statusCode).toBe(409);
    expect(frozen.json().error).toEqual({
      code: "OPTIMIZER_POLICY_FROZEN",
      message: "Optimizer policy cannot be changed in its current status.",
      details: [],
    });

    const archived = await patchPolicy(created.json().id, { status: "archived" });
    expect(archived.statusCode).toBe(200);
    expect(archived.json().status).toBe("archived");
  });

  it("hides cross-tenant policy identifiers and denies analyst writes", async () => {
    const foreign = await harness.pool.query<{ id: string }>(
      `INSERT INTO optimizer_policies
         (tenant_id, name, objective, max_downside_loss_cents, allowed_instruments, config)
       VALUES ($1, 'foreign policy', 'maximize_expected_savings', 500000,
               ARRAY['aws_compute_savings_plan']::text[], '{}')
       RETURNING id`,
      [harness.tenantB],
    );

    const hidden = await patchPolicy(foreign.rows[0]!.id, { status: "active" });
    expect(hidden.statusCode).toBe(404);
    expect(hidden.body).not.toContain(harness.tenantB);

    const own = await postPolicy(validPolicy("analyst write denied"));
    const denied = await patchPolicy(
      own.json().id,
      { status: "active" },
      optimizerPoliciesAuthorization(harness, "finops_analyst", "finops_analyst"),
    );
    expect(denied.statusCode).toBe(403);
  });
});

describe("GET /api/optimizer-policies", () => {
  it("lists only tenant policies with status filter and stable cursor pagination for JWT users", async () => {
    const firstCreated = await postPolicy(validPolicy("visible older"));
    const secondCreated = await postPolicy(validPolicy("visible newer"));
    await harness.pool.query("UPDATE optimizer_policies SET status = 'active' WHERE id = $1", [
      secondCreated.json().id,
    ]);
    await harness.pool.query(
      `INSERT INTO optimizer_policies
         (tenant_id, name, objective, max_downside_loss_cents, allowed_instruments, config)
       VALUES ($1, 'hidden foreign policy', 'maximize_expected_savings', 500000,
               ARRAY['aws_compute_savings_plan']::text[], '{}')`,
      [harness.tenantB],
    );

    const active = await harness.app.inject({
      method: "GET",
      url: "/api/optimizer-policies?status=active&limit=1",
      headers: optimizerPoliciesAuthorization(harness, "finops_analyst", "finops_analyst"),
    });
    expect(active.statusCode).toBe(200);
    expect(active.json().optimizer_policies).toHaveLength(1);
    expect(active.json().optimizer_policies[0].id).toBe(secondCreated.json().id);
    expect(active.body).not.toContain(harness.tenantB);
    expect(active.body).not.toContain("hidden foreign policy");

    const pageOne = await harness.app.inject({
      method: "GET",
      url: "/api/optimizer-policies?limit=1",
      headers: optimizerPoliciesAuthorization(harness),
    });
    expect(pageOne.statusCode).toBe(200);
    expect(pageOne.json().optimizer_policies[0].id).toBe(secondCreated.json().id);
    expect(pageOne.json().next_cursor).toEqual(expect.any(String));

    const pageTwo = await harness.app.inject({
      method: "GET",
      url: `/api/optimizer-policies?limit=1&cursor=${pageOne.json().next_cursor}`,
      headers: optimizerPoliciesAuthorization(harness),
    });
    expect(pageTwo.statusCode).toBe(200);
    expect(pageTwo.json().optimizer_policies[0].id).toBe(firstCreated.json().id);
  });

  it("rejects tenant-selecting filters and API keys", async () => {
    for (const query of [`tenant_id=${harness.tenantB}`, "limit=0", "status=queued", "unknown=1"]) {
      const response = await harness.app.inject({
        method: "GET",
        url: `/api/optimizer-policies?${query}`,
        headers: optimizerPoliciesAuthorization(harness),
      });
      expect(response.statusCode, query).toBe(400);
      expect(response.json().error.code).toBe("VALIDATION_ERROR");
    }

    const denied = await harness.app.inject({
      method: "GET",
      url: "/api/optimizer-policies",
      headers: { "x-api-key": harness.analystApiKey },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("FORBIDDEN");
  });
});

function validPolicy(name: string): Record<string, unknown> {
  return {
    name,
    objective: "maximize_expected_savings",
    max_downside_loss_cents: "500000",
    min_expected_savings_cents: "10000",
    max_utilization_gap_pct: "12.50",
    approval_threshold_cents: "250000",
    allowed_instruments: ["aws_compute_savings_plan"],
    config: { liquidity_penalty_bps: 100 },
  };
}

async function postPolicy(
  payload: Record<string, unknown>,
  headers = optimizerPoliciesAuthorization(harness),
): Promise<Awaited<ReturnType<OptimizerPoliciesHarness["app"]["inject"]>>> {
  return await harness.app.inject({
    method: "POST",
    url: "/api/optimizer-policies",
    headers: { "content-type": "application/json", ...headers },
    payload,
  });
}

async function patchPolicy(
  id: string,
  payload: Record<string, unknown>,
  headers = optimizerPoliciesAuthorization(harness),
): Promise<Awaited<ReturnType<OptimizerPoliciesHarness["app"]["inject"]>>> {
  return await harness.app.inject({
    method: "PATCH",
    url: `/api/optimizer-policies/${id}`,
    headers: { "content-type": "application/json", ...headers },
    payload,
  });
}
