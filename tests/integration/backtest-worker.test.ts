import { afterEach, describe, expect, it } from "vitest";

import { createBacktestsRepository } from "../../core/backtests/backtests-repository.js";
import { createBacktestWorker } from "../../core/backtests/backtest-worker.js";
import type { ObjectStore } from "../../core/shared/objectStore.js";
import { dropIsolatedDatabase } from "./helpers/postgres-database.js";
import {
  closeBacktestsHarness,
  createBacktestsHarness,
  type BacktestsHarness,
} from "./helpers/backtests-app.js";

let harness: BacktestsHarness | undefined;

afterEach(async () => {
  await closeBacktestsHarness(harness);
  await dropIsolatedDatabase(harness?.database);
  harness = undefined;
});

describe("backtest worker", () => {
  it("completes a queued replay with deterministic baseline metrics and a report snapshot", async () => {
    harness = await createBacktestsHarness("ccpo_backtest_worker_complete");
    const policyId = await insertActivePolicy();
    await insertUsageMonth("2026-01-15", "10000");
    await insertUsageMonth("2026-02-15", "10000");
    await insertUsageMonth("2026-03-15", "50000");
    const runId = await createQueuedBacktest(policyId, "last_month_steady_state");

    const result = await createBacktestWorker(
      createBacktestsRepository(harness.pool),
      harness.objectStore,
    ).processNextBacktest();

    expect(result).toEqual({
      processed: true,
      runId,
      status: "completed",
      outputUri: `backtests/${runId}/output.json`,
      reportSnapshotCreated: true,
    });
    const stored = await harness.pool.query<{
      status: string;
      output_uri: string | null;
      metrics: Record<string, unknown>;
      reports: string;
    }>(
      `SELECT b.status, b.output_uri, b.metrics,
              (SELECT count(*)::text
                 FROM report_snapshots rs
                WHERE rs.source_type = 'backtest_run' AND rs.source_id = b.id) AS reports
         FROM backtest_runs b
        WHERE b.id = $1`,
      [runId],
    );
    expect(stored.rows[0]).toMatchObject({
      status: "completed",
      output_uri: `backtests/${runId}/output.json`,
      reports: "1",
      metrics: {
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
      },
    });

    const output = JSON.parse(
      (await harness.objectStore.get(`backtests/${runId}/output.json`)).toString("utf8"),
    );
    expect(output).toMatchObject({
      schema_version: "backtest-run-output:v1",
      backtest_run_id: runId,
      metrics: stored.rows[0]!.metrics,
      baseline_results: [
        { baseline: "no_commitment", simulated_savings_cents: "0" },
        { baseline: "last_month_steady_state", simulated_savings_cents: "6000" },
        { baseline: "seventy_percent_utilization", simulated_savings_cents: "4200" },
      ],
    });
    expect(output.baseline_results[1].monthly_results).toMatchObject([
      {
        month: "2026-01",
        simulated_commitment_cents: "0",
        decision_inputs: { prior_months_seen: 0, latest_visible_month: null },
      },
      {
        month: "2026-02",
        simulated_commitment_cents: "10000",
        decision_inputs: { prior_months_seen: 1, latest_visible_month: "2026-01" },
      },
      {
        month: "2026-03",
        simulated_commitment_cents: "10000",
        decision_inputs: { prior_months_seen: 2, latest_visible_month: "2026-02" },
      },
    ]);
    expect(JSON.stringify({ output, stored: stored.rows[0] })).not.toMatch(
      /tenant_id|credential|password|secret|token|raw_row|stack/iu,
    );
    await expect(
      createBacktestWorker(
        createBacktestsRepository(harness.pool),
        harness.objectStore,
      ).processNextBacktest(),
    ).resolves.toEqual({ processed: false });
  });

  it("reports regret honestly when a prior-month baseline overcommits into a drop", async () => {
    harness = await createBacktestsHarness("ccpo_backtest_worker_regret");
    const policyId = await insertActivePolicy();
    await insertUsageMonth("2026-01-15", "50000");
    await insertUsageMonth("2026-02-15", "10000");
    const runId = await createQueuedBacktest(policyId, "last_month_steady_state");

    await createBacktestWorker(
      createBacktestsRepository(harness.pool),
      harness.objectStore,
    ).processNextBacktest();

    const stored = await harness.pool.query<{ metrics: Record<string, unknown> }>(
      "SELECT metrics FROM backtest_runs WHERE id = $1",
      [runId],
    );
    expect(stored.rows[0]!.metrics).toMatchObject({
      selected_simulated_savings_cents: "-25000",
      selected_regret_cents: "25000",
      selected_downside_loss_cents: "25000",
      best_baseline: "no_commitment",
      best_simulated_savings_cents: "0",
    });
  });

  it("marks artifact failures as sanitized failed runs", async () => {
    harness = await createBacktestsHarness("ccpo_backtest_worker_failure");
    const policyId = await insertActivePolicy();
    await insertUsageMonth("2026-01-15", "10000");
    const runId = await createQueuedBacktest(policyId, "last_month_steady_state");

    const result = await createBacktestWorker(
      createBacktestsRepository(harness.pool),
      failingObjectStore(),
    ).processNextBacktest();

    expect(result).toEqual({
      processed: true,
      runId,
      status: "failed",
      outputUri: null,
      reportSnapshotCreated: false,
    });
    const stored = await harness.pool.query<{
      status: string;
      output_uri: string | null;
      metrics: Record<string, unknown>;
      error_details: Record<string, unknown>;
    }>("SELECT status, output_uri, metrics, error_details FROM backtest_runs WHERE id = $1", [
      runId,
    ]);
    expect(stored.rows[0]).toEqual({
      status: "failed",
      output_uri: null,
      metrics: {},
      error_details: { code: "BACKTEST_WORKER_FAILED" },
    });
    expect(JSON.stringify(stored.rows[0])).not.toMatch(/boom|secret|credential|stack/iu);
  });
});

async function insertActivePolicy(): Promise<string> {
  const result = await harness!.pool.query<{ id: string }>(
    `INSERT INTO optimizer_policies
       (tenant_id, name, objective, max_downside_loss_cents, min_expected_savings_cents,
        max_utilization_gap_pct, approval_threshold_cents, allowed_instruments, config)
     VALUES ($1, 'backtest-worker-policy', 'maximize_expected_savings',
             500000, 10000, 12.50, 250000,
             ARRAY['aws_compute_savings_plan']::text[],
             '{"backtest_discount_bps":3000}'::jsonb)
     RETURNING id`,
    [harness!.tenantA],
  );
  await harness!.pool.query("UPDATE optimizer_policies SET status = 'active' WHERE id = $1", [
    result.rows[0]!.id,
  ]);
  return result.rows[0]!.id;
}

async function createQueuedBacktest(policyId: string, baseline: string): Promise<string> {
  const response = await harness!.app.inject({
    method: "POST",
    url: "/api/backtests",
    headers: { "content-type": "application/json", "x-api-key": harness!.analystApiKey },
    payload: {
      name: `${baseline} replay`,
      policy_id: policyId,
      baseline,
      window_start: "2026-01-01",
      window_end: "2026-03-31",
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json().id;
}

async function insertUsageMonth(usageStartDate: string, onDemandCostCents: string): Promise<void> {
  const account = await harness!.pool.query<{ id: string }>(
    `INSERT INTO cloud_accounts
       (tenant_id, provider, external_ref, display_name, currency)
     VALUES ($1, 'aws', $2, $2, 'USD')
     RETURNING id`,
    [harness!.tenantA, `backtest-worker-${usageStartDate}`],
  );
  const batch = await harness!.pool.query<{ id: string }>(
    `INSERT INTO import_batches
       (tenant_id, cloud_account_id, source, format, object_uri, schema_version, status)
     VALUES ($1, $2, 'synthetic', 'csv', $3, 'synthetic_csv:v1', 'completed')
     RETURNING id`,
    [harness!.tenantA, account.rows[0]!.id, `imports/backtest-worker-${usageStartDate}.csv`],
  );
  await harness!.pool.query(
    `INSERT INTO usage_line_items
       (tenant_id, import_batch_id, cloud_account_id, provider, service_code, sku,
        region, usage_start, usage_end, usage_quantity, usage_unit,
        on_demand_cost_cents, realized_cost_cents, commitment_applied_cents, tags)
     VALUES ($1, $2, $3, 'aws', 'AmazonEC2', 'm7g.large',
        'us-east-1', $4::timestamptz, $4::timestamptz + interval '1 day', '1.00000000', 'Hrs',
        $5::bigint, $5::bigint, 0, '{}'::jsonb)`,
    [harness!.tenantA, batch.rows[0]!.id, account.rows[0]!.id, usageStartDate, onDemandCostCents],
  );
}

function failingObjectStore(): ObjectStore {
  return {
    put: async () => {
      throw new Error("boom secret credential stack");
    },
    get: async () => Buffer.from("{}"),
    delete: async () => undefined,
    health: async () => ({ ready: true }),
    close: async () => undefined,
  };
}
