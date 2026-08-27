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
  harness = await createBacktestsHarness("ccpo_backtests_ui");
});

afterAll(async () => {
  await closeBacktestsHarness(harness);
  await dropIsolatedDatabase(harness?.database);
});

describe("/backtests UI", () => {
  it("renders replay status, comparable baseline metrics, and no-future-leakage evidence", async () => {
    const policyId = await insertPolicy("ui-complete");
    const completed = await createQueuedBacktest(policyId, "last_month_steady_state");
    await completeBacktest(completed);
    const foreign = await insertForeignBacktest();

    const queue = await harness.app.inject({
      method: "GET",
      url: "/backtests",
      headers: {
        accept: "text/html",
        ...backtestsAuthorization(harness, "read_only_auditor", "read_only_auditor"),
      },
    });

    expect(queue.statusCode).toBe(200);
    expect(queue.headers["content-type"]).toContain("text/html");
    expect(queue.body).toContain("<title>Backtests | Cloud Commitment Portfolio Optimizer</title>");
    expect(queue.body).toContain("Replay credibility");
    expect(queue.body).toContain("Compare baselines");
    expect(queue.body).toContain(completed);
    expect(queue.body).toContain("Last-month steady state");
    expect(queue.body).toContain("No future leakage");
    expect(queue.body).toContain("Review replay");
    expect(queue.body).not.toContain(foreign);
    expect(queue.body).not.toMatch(
      /<script|input_snapshot_uri|output_uri|tenant_id|key_hash|password|secret|stack|authorization|Bearer/iu,
    );

    const detail = await harness.app.inject({
      method: "GET",
      url: `/backtests/${completed}`,
      headers: {
        accept: "text/html",
        ...backtestsAuthorization(harness, "finance_approver", "finance_approver"),
      },
    });

    expect(detail.statusCode).toBe(200);
    expect(detail.body).toContain("Backtest replay detail");
    expect(detail.body).toContain("Selected baseline savings");
    expect(detail.body).toContain("Selected regret");
    expect(detail.body).toContain("Downside loss");
    expect(detail.body).toContain("Baseline comparison");
    expect(detail.body).toContain("No commitment");
    expect(detail.body).toContain("70% utilization");
    expect(detail.body).toContain("12-month replay evidence");
    expect(detail.body).toContain("No future leakage");
    expect(detail.body).toContain("2026-03");
    expect(detail.body).toContain("$60.00");
    expect(detail.body).not.toMatch(
      /<script|input_snapshot_uri|output_uri|tenant_id|key_hash|password|secret|stack|authorization|Bearer/iu,
    );
  });

  it("renders failed replays as sanitized diagnostics and hides foreign detail", async () => {
    const policyId = await insertPolicy("ui-failed");
    const failed = await createQueuedBacktest(policyId, "seventy_percent_utilization");
    await failBacktest(failed);
    const foreign = await insertForeignBacktest();

    const failedPage = await harness.app.inject({
      method: "GET",
      url: "/backtests",
      headers: { accept: "text/html", ...backtestsAuthorization(harness) },
    });
    expect(failedPage.statusCode).toBe(200);
    expect(failedPage.body).toContain("BACKTEST_WORKER_FAILED");
    expect(failedPage.body).toContain("Replay failed");

    const hidden = await harness.app.inject({
      method: "GET",
      url: `/backtests/${foreign}`,
      headers: { accept: "text/html", ...backtestsAuthorization(harness) },
    });
    expect(hidden.statusCode).toBe(404);
    expect(hidden.body).not.toContain(harness.tenantB);
  });

  it("requires authentication", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: "/backtests",
      headers: { accept: "text/html" },
    });
    expect(response.statusCode).toBe(401);
    expect(response.body).not.toMatch(/(?:input_snapshot_uri|password|token|stack|postgres)/iu);
  });
});

async function insertPolicy(label: string): Promise<string> {
  const result = await harness.pool.query<{ id: string }>(
    `INSERT INTO optimizer_policies
       (tenant_id, name, objective, max_downside_loss_cents, min_expected_savings_cents,
        max_utilization_gap_pct, approval_threshold_cents, allowed_instruments, config)
     VALUES ($1, $2, 'maximize_expected_savings', 500000, 10000, 12.50, 250000,
             ARRAY['aws_compute_savings_plan']::text[], '{}')
     RETURNING id`,
    [harness.tenantA, `${label}-${randomUUID()} policy`],
  );
  await harness.pool.query("UPDATE optimizer_policies SET status = 'active' WHERE id = $1", [
    result.rows[0]!.id,
  ]);
  return result.rows[0]!.id;
}

async function createQueuedBacktest(policyId: string, baseline: string): Promise<string> {
  const response = await harness.app.inject({
    method: "POST",
    url: "/api/backtests",
    headers: { "content-type": "application/json", ...backtestsAuthorization(harness) },
    payload: {
      policy_id: policyId,
      baseline,
      window_start: "2026-01-01",
      window_end: "2026-03-31",
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json().id as string;
}

async function completeBacktest(id: string): Promise<void> {
  await harness.pool.query("UPDATE backtest_runs SET status = 'running' WHERE id = $1", [id]);
  await harness.pool.query(
    `UPDATE backtest_runs
        SET status = 'completed',
            output_uri = $2,
            metrics = $3::jsonb,
            error_details = '{}'::jsonb
      WHERE id = $1`,
    [id, `backtests/${id}/output.json`, JSON.stringify(metrics())],
  );
}

async function failBacktest(id: string): Promise<void> {
  await harness.pool.query("UPDATE backtest_runs SET status = 'running' WHERE id = $1", [id]);
  await harness.pool.query(
    `UPDATE backtest_runs
        SET status = 'failed', metrics = '{}'::jsonb,
            error_details = '{"code":"BACKTEST_WORKER_FAILED"}'::jsonb
      WHERE id = $1`,
    [id],
  );
}

function metrics(): Record<string, unknown> {
  const monthly = [
    {
      month: "2026-01",
      simulated_commitment_cents: "0",
      simulated_cost_cents: "10000",
      simulated_savings_cents: "0",
      regret_cents: "0",
      decision_inputs: { prior_months_seen: 0, latest_visible_month: null },
    },
    {
      month: "2026-02",
      simulated_commitment_cents: "10000",
      simulated_cost_cents: "7000",
      simulated_savings_cents: "3000",
      regret_cents: "0",
      decision_inputs: { prior_months_seen: 1, latest_visible_month: "2026-01" },
    },
    {
      month: "2026-03",
      simulated_commitment_cents: "10000",
      simulated_cost_cents: "47000",
      simulated_savings_cents: "3000",
      regret_cents: "0",
      decision_inputs: { prior_months_seen: 2, latest_visible_month: "2026-02" },
    },
  ];
  return {
    baseline: "last_month_steady_state",
    replay_months: 3,
    source_line_items: 3,
    total_on_demand_cost_cents: "70000",
    selected_simulated_savings_cents: "6000",
    selected_regret_cents: "0",
    selected_downside_loss_cents: "0",
    best_baseline: "last_month_steady_state",
    best_simulated_savings_cents: "6000",
    no_future_leakage: true,
    baseline_results: [
      {
        baseline: "no_commitment",
        simulated_savings_cents: "0",
        regret_cents: "0",
        downside_loss_cents: "0",
        monthly_results: monthly.map((entry) => ({ ...entry, simulated_savings_cents: "0" })),
      },
      {
        baseline: "last_month_steady_state",
        simulated_savings_cents: "6000",
        regret_cents: "0",
        downside_loss_cents: "0",
        monthly_results: monthly,
      },
      {
        baseline: "seventy_percent_utilization",
        simulated_savings_cents: "4200",
        regret_cents: "0",
        downside_loss_cents: "0",
        monthly_results: monthly.map((entry) => ({ ...entry, simulated_savings_cents: "2100" })),
      },
    ],
  };
}

async function insertForeignBacktest(): Promise<string> {
  const policy = await harness.pool.query<{ id: string }>(
    `INSERT INTO optimizer_policies
       (tenant_id, name, objective, max_downside_loss_cents, allowed_instruments, config)
     VALUES ($1, $2, 'maximize_expected_savings', 500000,
             ARRAY['aws_compute_savings_plan']::text[], '{}')
     RETURNING id`,
    [harness.tenantB, `foreign-${randomUUID()} policy`],
  );
  await harness.pool.query("UPDATE optimizer_policies SET status = 'active' WHERE id = $1", [
    policy.rows[0]!.id,
  ]);
  const run = await harness.pool.query<{ id: string }>(
    `INSERT INTO backtest_runs
       (tenant_id, name, policy_id, baseline, window_start, window_end, input_snapshot_uri)
     VALUES ($1, $2, $3, 'no_commitment', '2026-01-01', '2026-01-31', $4)
     RETURNING id`,
    [
      harness.tenantB,
      `foreign-${randomUUID()} replay`,
      policy.rows[0]!.id,
      `backtests/foreign-${randomUUID()}/input.json`,
    ],
  );
  return run.rows[0]!.id;
}
