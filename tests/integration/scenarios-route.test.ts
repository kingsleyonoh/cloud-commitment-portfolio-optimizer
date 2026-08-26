import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { dropIsolatedDatabase } from "./helpers/postgres-database.js";
import {
  closeOptimizerRunsHarness,
  createOptimizerRunsHarness,
  optimizerRunsAuthorization,
  type OptimizerRunsHarness,
} from "./helpers/optimizer-runs-app.js";

let harness: OptimizerRunsHarness;

beforeAll(async () => {
  harness = await createOptimizerRunsHarness("ccpo_scenarios");
});

afterAll(async () => {
  await closeOptimizerRunsHarness(harness);
  await dropIsolatedDatabase(harness?.database);
});

describe("/api/scenarios", () => {
  it("creates, lists, paginates, and reads scenarios within the authenticated tenant", async () => {
    const first = await createScenario("Migration shock", { demand_growth_pct: "12.50" });
    const second = await createScenario("Renewal shock", { demand_growth_pct: "-8.00" });

    const page = await harness.app.inject({
      method: "GET",
      url: "/api/scenarios?limit=1",
      headers: optimizerRunsAuthorization(harness, "tenant_admin", "tenant_admin"),
    });
    expect(page.statusCode).toBe(200);
    const body = page.json() as {
      scenarios: Array<{ id: string; name: string; shock_config: Record<string, unknown> }>;
      next_cursor: string | null;
    };
    expect(body.scenarios).toHaveLength(1);
    expect(body.scenarios[0]?.name).toBe(second.name);
    expect(body.scenarios[0]?.shock_config).toEqual({ demand_growth_pct: "-8.00" });
    expect(body.next_cursor).toEqual(expect.any(String));

    const next = await harness.app.inject({
      method: "GET",
      url: `/api/scenarios?limit=1&cursor=${encodeURIComponent(body.next_cursor!)}`,
      headers: optimizerRunsAuthorization(harness, "finops_analyst", "finops_analyst"),
    });
    expect(next.statusCode).toBe(200);
    expect(next.json().scenarios).toEqual([
      expect.objectContaining({ id: first.id, name: first.name }),
    ]);

    const detail = await harness.app.inject({
      method: "GET",
      url: `/api/scenarios/${first.id}`,
      headers: optimizerRunsAuthorization(harness, "read_only_auditor", "read_only_auditor"),
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      id: first.id,
      name: first.name,
      shock_config: { demand_growth_pct: "12.50" },
      status: "draft",
    });
  });

  it("enforces mutation roles, rejects secrets, and does not reveal another tenant", async () => {
    const analyst = await harness.app.inject({
      method: "POST",
      url: "/api/scenarios",
      headers: optimizerRunsAuthorization(harness, "finops_analyst", "finops_analyst"),
      payload: { name: "Analyst scenario", shock_config: {} },
    });
    expect(analyst.statusCode).toBe(201);

    const approver = await harness.app.inject({
      method: "POST",
      url: "/api/scenarios",
      headers: optimizerRunsAuthorization(harness, "finance_approver", "finance_approver"),
      payload: { name: "Forbidden scenario", shock_config: {} },
    });
    expect(approver.statusCode).toBe(403);

    const secret = await harness.app.inject({
      method: "POST",
      url: "/api/scenarios",
      headers: optimizerRunsAuthorization(harness, "tenant_admin", "tenant_admin"),
      payload: { name: "Secret scenario", shock_config: { api_token: "never" } },
    });
    expect(secret.statusCode).toBe(400);

    const foreign = await harness.pool.query<{ id: string }>(
      `INSERT INTO scenarios (tenant_id, name, shock_config)
       VALUES ($1, $2, '{}'::jsonb) RETURNING id`,
      [harness.tenantB, "Foreign scenario"],
    );
    const hidden = await harness.app.inject({
      method: "GET",
      url: `/api/scenarios/${foreign.rows[0]!.id}`,
      headers: optimizerRunsAuthorization(harness, "tenant_admin", "tenant_admin"),
    });
    expect(hidden.statusCode).toBe(404);
    expect(hidden.body).not.toContain(harness.tenantB);
  });

  it("requires a completed forecast run when a base forecast is supplied", async () => {
    const model = await harness.pool.query<{ id: string }>(
      `INSERT INTO forecast_models
         (tenant_id, name, provider_scope, service_scope, horizon_months, method, config, status)
       VALUES ($1, 'Scenario test model', ARRAY['aws'], ARRAY['AmazonEC2'], 12,
               'seasonal_naive', '{}'::jsonb, 'draft') RETURNING id`,
      [harness.tenantA],
    );
    await harness.pool.query("UPDATE forecast_models SET status = 'active' WHERE id = $1", [
      model.rows[0]!.id,
    ]);
    const run = await harness.pool.query<{ id: string }>(
      `INSERT INTO forecast_runs
         (tenant_id, forecast_model_id, input_window_start, input_window_end, horizon_months,
          random_seed, status)
       VALUES ($1, $2, '2026-01-01', '2026-03-31', 12, 1, 'queued') RETURNING id`,
      [harness.tenantA, model.rows[0]!.id],
    );
    const response = await harness.app.inject({
      method: "POST",
      url: "/api/scenarios",
      headers: optimizerRunsAuthorization(harness, "tenant_admin", "tenant_admin"),
      payload: {
        name: "Queued forecast scenario",
        base_forecast_run_id: run.rows[0]!.id,
        shock_config: {},
      },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("SCENARIOS_UNAVAILABLE");
  });

  it("renders an accessible scenario workbench and accepts the browser form", async () => {
    const page = await harness.app.inject({
      method: "GET",
      url: "/scenarios",
      headers: {
        accept: "text/html",
        ...optimizerRunsAuthorization(harness, "tenant_admin", "tenant_admin"),
      },
    });
    expect(page.statusCode).toBe(200);
    expect(page.headers["content-type"]).toContain("text/html");
    expect(page.body).toContain("Scenario workbench");
    expect(page.body).toContain('aria-label="Scenario status summary"');
    expect(page.body).toContain('name="shock_config"');
    expect(page.body).not.toMatch(/<script|api_token|tenant_id|password|secret|authorization|Bearer/iu);

    const created = await harness.app.inject({
      method: "POST",
      url: "/scenarios",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...optimizerRunsAuthorization(harness, "finops_analyst", "finops_analyst"),
      },
      payload: new URLSearchParams({
        name: "Browser scenario",
        description: "Submitted from the workbench.",
        shock_config: '{"migration":"12.50"}',
      }).toString(),
    });
    expect(created.statusCode).toBe(303);
    expect(created.headers.location).toBe("/scenarios");
  });
});

async function createScenario(name: string, shockConfig: Record<string, unknown>) {
  const response = await harness.app.inject({
    method: "POST",
    url: "/api/scenarios",
    headers: optimizerRunsAuthorization(harness, "tenant_admin", "tenant_admin"),
    payload: { name, shock_config: shockConfig },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { id: string; name: string };
}
