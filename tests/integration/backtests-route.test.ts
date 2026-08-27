import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { dropIsolatedDatabase } from "./helpers/postgres-database.js";
import {
  backtestsAuthorization,
  closeBacktestsHarness,
  createBacktestsHarness,
  type BacktestsHarness,
} from "./helpers/backtests-app.js";

let harness: BacktestsHarness;

beforeAll(async () => {
  harness = await createBacktestsHarness("ccpo_backtests_route");
});

afterAll(async () => {
  await closeBacktestsHarness(harness);
  await dropIsolatedDatabase(harness?.database);
});

describe("POST /api/backtests", () => {
  it("queues a same-tenant backtest with a frozen deterministic input snapshot", async () => {
    const policyId = await insertPolicy("primary", "active");
    const response = await postBacktest({
      name: "Q1 Replay",
      policy_id: policyId,
      baseline: "last_month_steady_state",
      window_start: "2026-01-01",
      window_end: "2026-03-31",
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      name: "Q1 Replay",
      policy_id: policyId,
      baseline: "last_month_steady_state",
      window_start: "2026-01-01",
      window_end: "2026-03-31",
      status: "queued",
      output_uri: null,
      metrics: {},
      error_details: {},
      created_by_user_id: harness.actors.get("tenant_admin"),
    });
    expect(response.json().input_snapshot_uri).toMatch(/^backtests\/[0-9a-f-]+\/input\.json$/u);
    expect(response.body).not.toMatch(/tenant_id|credential|password|secret|token|raw_row|stack/iu);

    const snapshot = JSON.parse(
      (await harness.objectStore.get(response.json().input_snapshot_uri)).toString("utf8"),
    );
    expect(snapshot).toMatchObject({
      contract_version: "backtest-run-input-snapshot/v1",
      run_id: response.json().id,
      policy: { id: policyId, status: "active" },
      baseline: "last_month_steady_state",
      window: { start: "2026-01-01", end: "2026-03-31", max_months: 12 },
      random_seed: "20260826",
    });
  });

  it("defaults the baseline/name and records no user id for analyst API-key runs", async () => {
    const policyId = await insertPolicy("api-key", "active");
    const response = await postBacktest(
      {
        policy_id: policyId,
        window_start: "2026-04-01",
        window_end: "2026-04-30",
      },
      { "x-api-key": harness.analystApiKey },
    );

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      name: "Backtest 2026-04-01 through 2026-04-30",
      baseline: "seventy_percent_utilization",
      created_by_user_id: null,
    });
  });

  it("rejects foreign, inactive, invalid-window, too-large-window, and unknown-field inputs", async () => {
    const activePolicy = await insertPolicy("reject", "active");
    const inactivePolicy = await insertPolicy("inactive", "draft");
    const foreignPolicy = await insertForeignPolicy();

    for (const [payload, code] of [
      [
        {
          policy_id: foreignPolicy,
          window_start: "2026-01-01",
          window_end: "2026-01-31",
        },
        "NOT_FOUND",
      ],
      [
        {
          policy_id: inactivePolicy,
          window_start: "2026-01-01",
          window_end: "2026-01-31",
        },
        "BACKTEST_INPUT_INVALID",
      ],
      [
        {
          policy_id: activePolicy,
          window_start: "2026-02-01",
          window_end: "2026-01-31",
        },
        "VALIDATION_ERROR",
      ],
      [
        {
          policy_id: activePolicy,
          window_start: "2025-01-01",
          window_end: "2026-12-31",
        },
        "BACKTEST_INPUT_INVALID",
      ],
      [
        {
          policy_id: activePolicy,
          window_start: "2026-01-01",
          window_end: "2026-01-31",
          unknown: true,
        },
        "VALIDATION_ERROR",
      ],
    ] as const) {
      const response = await postBacktest(payload);
      expect(response.json().error.code).toBe(code);
      expect(response.body).not.toContain(harness.tenantB);
    }
  });

  it("blocks finance approvers and read-only auditors from creating backtests", async () => {
    const policyId = await insertPolicy("mutator-denied", "active");
    const before = await countBacktests();
    for (const [actor, role] of [
      ["finance_approver", "finance_approver"],
      ["read_only_auditor", "read_only_auditor"],
    ] as const) {
      const response = await postBacktest(
        {
          policy_id: policyId,
          window_start: "2026-01-01",
          window_end: "2026-01-31",
        },
        backtestsAuthorization(harness, actor, role),
      );
      expect(response.statusCode).toBe(403);
    }
    await expect(countBacktests()).resolves.toBe(before);
  });
});

describe("GET /api/backtests", () => {
  it("lists tenant-scoped backtests with status, baseline, policy, and limit filters", async () => {
    const policyA = await insertPolicy("list-a", "active");
    const policyB = await insertPolicy("list-b", "active");
    const runA = await createBacktest(policyA, "no_commitment", "2026-01-01", "2026-01-31");
    await createBacktest(policyB, "seventy_percent_utilization", "2026-02-01", "2026-02-28");
    await markRunning(runA);
    await insertForeignBacktest();

    const response = await harness.app.inject({
      method: "GET",
      url: `/api/backtests?status=running&baseline=no_commitment&policy_id=${policyA}&limit=1`,
      headers: backtestsAuthorization(harness, "finance_approver", "finance_approver"),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().backtests).toHaveLength(1);
    expect(response.json().backtests[0]).toMatchObject({
      id: runA,
      policy_id: policyA,
      baseline: "no_commitment",
      status: "running",
    });
    expect(response.body).not.toContain(harness.tenantB);
  });
});

describe("GET /api/backtests/{id}", () => {
  it("returns a same-tenant backtest detail and hides foreign identifiers", async () => {
    const policyId = await insertPolicy("detail", "active");
    const created = await createBacktest(policyId, "custom", "2026-05-01", "2026-05-31");
    const response = await harness.app.inject({
      method: "GET",
      url: `/api/backtests/${created}`,
      headers: backtestsAuthorization(harness, "read_only_auditor", "read_only_auditor"),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      backtest: {
        id: created,
        policy_id: policyId,
        baseline: "custom",
        status: "queued",
        metrics: {},
        output_uri: null,
      },
    });

    const foreign = await insertForeignBacktest();
    const hidden = await harness.app.inject({
      method: "GET",
      url: `/api/backtests/${foreign}`,
      headers: backtestsAuthorization(harness),
    });
    expect(hidden.statusCode).toBe(404);
    expect(hidden.body).not.toContain(harness.tenantB);
  });
});

async function insertPolicy(label: string, status: "draft" | "active"): Promise<string> {
  const result = await harness.pool.query<{ id: string }>(
    `INSERT INTO optimizer_policies
       (tenant_id, name, objective, max_downside_loss_cents, min_expected_savings_cents,
        max_utilization_gap_pct, approval_threshold_cents, allowed_instruments, config)
     VALUES ($1, $2, 'maximize_expected_savings', 500000, 10000, 12.50, 250000,
             ARRAY['aws_compute_savings_plan']::text[], '{"liquidity_penalty_bps":100}'::jsonb)
     RETURNING id`,
    [harness.tenantA, `${label}-${randomUUID()} policy`],
  );
  if (status === "active") {
    await harness.pool.query("UPDATE optimizer_policies SET status = 'active' WHERE id = $1", [
      result.rows[0]!.id,
    ]);
  }
  return result.rows[0]!.id;
}

async function insertForeignPolicy(): Promise<string> {
  const result = await harness.pool.query<{ id: string }>(
    `INSERT INTO optimizer_policies
       (tenant_id, name, objective, max_downside_loss_cents, allowed_instruments, config)
     VALUES ($1, $2, 'maximize_expected_savings', 500000,
             ARRAY['aws_compute_savings_plan']::text[], '{}')
     RETURNING id`,
    [harness.tenantB, `foreign-${randomUUID()} policy`],
  );
  await harness.pool.query("UPDATE optimizer_policies SET status = 'active' WHERE id = $1", [
    result.rows[0]!.id,
  ]);
  return result.rows[0]!.id;
}

async function createBacktest(
  policyId: string,
  baseline: string,
  windowStart: string,
  windowEnd: string,
): Promise<string> {
  const response = await postBacktest({
    policy_id: policyId,
    baseline,
    window_start: windowStart,
    window_end: windowEnd,
  });
  expect(response.statusCode).toBe(201);
  return response.json().id;
}

async function insertForeignBacktest(): Promise<string> {
  const policyId = await insertForeignPolicy();
  const result = await harness.pool.query<{ id: string }>(
    `INSERT INTO backtest_runs
       (tenant_id, name, policy_id, baseline, window_start, window_end, input_snapshot_uri)
     VALUES ($1, $2, $3, 'no_commitment', '2026-01-01', '2026-01-31', $4)
     RETURNING id`,
    [
      harness.tenantB,
      `foreign-${randomUUID()} replay`,
      policyId,
      `backtests/foreign-${randomUUID()}/input.json`,
    ],
  );
  return result.rows[0]!.id;
}

async function markRunning(id: string): Promise<void> {
  await harness.pool.query("UPDATE backtest_runs SET status = 'running' WHERE id = $1", [id]);
}

async function countBacktests(): Promise<string> {
  const result = await harness.pool.query<{ count: string }>("SELECT count(*) FROM backtest_runs");
  return result.rows[0]!.count;
}

async function postBacktest(
  payload: Record<string, unknown>,
  headers = backtestsAuthorization(harness),
): Promise<Awaited<ReturnType<BacktestsHarness["app"]["inject"]>>> {
  return await harness.app.inject({
    method: "POST",
    url: "/api/backtests",
    headers: { "content-type": "application/json", ...headers },
    payload,
  });
}
