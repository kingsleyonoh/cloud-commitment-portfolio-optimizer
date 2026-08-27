import { afterEach, describe, expect, it } from "vitest";

import { createOptimizerRunsRepository } from "../../core/optimizer-runs/optimizer-runs-repository.js";
import { createOptimizerWorker } from "../../core/optimizer-runs/optimizer-worker.js";
import type { ObjectStore } from "../../core/shared/objectStore.js";
import { dropIsolatedDatabase } from "./helpers/postgres-database.js";
import {
  closeOptimizerRunsHarness,
  createOptimizerRunsHarness,
  type OptimizerRunsHarness,
} from "./helpers/optimizer-runs-app.js";

let harness: OptimizerRunsHarness | undefined;

afterEach(async () => {
  await closeOptimizerRunsHarness(harness);
  await dropIsolatedDatabase(harness?.database);
  harness = undefined;
});

describe("optimizer worker", () => {
  it("claims a queued run, writes deterministic frontier artifacts, and creates one ready recommendation", async () => {
    harness = await createOptimizerRunsHarness("ccpo_optimizer_worker_complete");
    const fixture = await createQueuedRun(harness.objectStore, {
      label: "complete",
      forecastCosts: ["10000", "12000", "8000"],
      hourlyRateCents: "10",
      maxDownsideLossCents: "2000",
      minExpectedSavingsCents: "1000",
    });

    const worker = createOptimizerWorker(
      createOptimizerRunsRepository(harness.pool),
      harness.objectStore,
    );
    const result = await worker.processNextOptimizerRun();

    expect(result).toMatchObject({
      processed: true,
      runId: fixture.runId,
      status: "completed",
      outputUri: `optimizer-runs/${fixture.runId}/output.json`,
      frontierUri: `optimizer-runs/${fixture.runId}/frontier.json`,
      recommendationCount: 1,
    });
    await expect(worker.processNextOptimizerRun()).resolves.toEqual({ processed: false });

    const stored = await harness.pool.query<{
      status: string;
      output_uri: string | null;
      frontier_uri: string | null;
      recommendations: string;
    }>(
      `SELECT r.status, r.output_uri, r.frontier_uri,
              (SELECT count(*)::text FROM recommendations rec WHERE rec.optimizer_run_id = r.id)
                AS recommendations
         FROM optimizer_runs r
        WHERE r.id = $1`,
      [fixture.runId],
    );
    expect(stored.rows[0]).toEqual({
      status: "completed",
      output_uri: `optimizer-runs/${fixture.runId}/output.json`,
      frontier_uri: `optimizer-runs/${fixture.runId}/frontier.json`,
      recommendations: "1",
    });

    const recommendation = await harness.pool.query<{
      recommendation_type: string;
      service_code: string;
      region: string;
      term_months: number;
      commitment_amount_cents: string;
      expected_savings_cents: string;
      p95_downside_loss_cents: string;
      utilization_p50_pct: string;
      utilization_p95_pct: string;
      confidence_score: string;
      risk_band: string;
      status: string;
      approval_required: boolean;
      explanation: Record<string, unknown>;
    }>(
      `SELECT recommendation_type, service_code, region, term_months,
              commitment_amount_cents::text, expected_savings_cents::text,
              p95_downside_loss_cents::text,
              to_char(utilization_p50_pct, 'FM990.00') AS utilization_p50_pct,
              to_char(utilization_p95_pct, 'FM990.00') AS utilization_p95_pct,
              to_char(confidence_score, 'FM0.0000') AS confidence_score,
              risk_band, status, approval_required, explanation
         FROM recommendations
        WHERE optimizer_run_id = $1`,
      [fixture.runId],
    );
    expect(recommendation.rows[0]).toMatchObject({
      recommendation_type: "buy",
      service_code: "AmazonEC2",
      region: "us-east-1",
      term_months: 12,
      commitment_amount_cents: "10000",
      expected_savings_cents: "2033",
      p95_downside_loss_cents: "1300",
      utilization_p50_pct: "100.00",
      utilization_p95_pct: "100.00",
      confidence_score: "0.9000",
      risk_band: "medium",
      status: "ready",
      approval_required: false,
    });
    expect(recommendation.rows[0]!.explanation).toMatchObject({
      baseline_name: "on_demand",
      binding_constraints: ["risk_budget"],
      price_table_version_ids: [fixture.priceVersionId],
    });

    const output = JSON.parse(
      (await harness.objectStore.get(`optimizer-runs/${fixture.runId}/output.json`)).toString(
        "utf8",
      ),
    );
    expect(output).toMatchObject({
      schema_version: "optimizer-run-output:v1",
      optimizer_run_id: fixture.runId,
      selected_candidate: {
        provider: "aws",
        instrument: "aws_compute_savings_plan",
        expected_savings_cents: "2033",
        p95_downside_loss_cents: "1300",
      },
    });

    const frontier = JSON.parse(
      (await harness.objectStore.get(`optimizer-runs/${fixture.runId}/frontier.json`)).toString(
        "utf8",
      ),
    );
    expect(frontier).toMatchObject({
      schema_version: "optimizer-frontier:v1",
      optimizer_run_id: fixture.runId,
      summary: {
        candidate_count: 1,
        feasible_count: 1,
        selected_expected_savings_cents: "2033",
        selected_p95_downside_loss_cents: "1300",
      },
    });
    expect(
      JSON.stringify({ output, frontier, recommendation: recommendation.rows[0] }),
    ).not.toMatch(/tenant_id|credential|password|secret|token|raw_row|stack|candidate_id/iu);

    const detail = await harness.app.inject({
      method: "GET",
      url: `/api/optimizer-runs/${fixture.runId}`,
      headers: { "x-api-key": harness.analystApiKey },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      optimizer_run: {
        id: fixture.runId,
        status: "completed",
        frontier_uri: `optimizer-runs/${fixture.runId}/frontier.json`,
      },
      frontier_summary: {
        candidate_count: 1,
        feasible_count: 1,
        selected_expected_savings_cents: "2033",
        selected_p95_downside_loss_cents: "1300",
      },
    });
  });

  it("marks infeasible objectives with ranked relaxations and no recommendation rows", async () => {
    harness = await createOptimizerRunsHarness("ccpo_optimizer_worker_infeasible");
    const fixture = await createQueuedRun(harness.objectStore, {
      label: "infeasible",
      forecastCosts: ["1000", "1000", "1000"],
      hourlyRateCents: "10",
      maxDownsideLossCents: "10",
      minExpectedSavingsCents: "500",
    });

    const result = await createOptimizerWorker(
      createOptimizerRunsRepository(harness.pool),
      harness.objectStore,
    ).processNextOptimizerRun();

    expect(result).toMatchObject({
      processed: true,
      runId: fixture.runId,
      status: "infeasible",
      outputUri: null,
      frontierUri: `optimizer-runs/${fixture.runId}/frontier.json`,
      recommendationCount: 0,
    });
    const stored = await harness.pool.query<{
      status: string;
      frontier_uri: string | null;
      infeasibility_details: Record<string, unknown>;
      recommendations: string;
    }>(
      `SELECT r.status, r.frontier_uri, r.infeasibility_details,
              (SELECT count(*)::text FROM recommendations rec WHERE rec.optimizer_run_id = r.id)
                AS recommendations
         FROM optimizer_runs r
        WHERE r.id = $1`,
      [fixture.runId],
    );
    expect(stored.rows[0]).toMatchObject({
      status: "infeasible",
      frontier_uri: `optimizer-runs/${fixture.runId}/frontier.json`,
      recommendations: "0",
      infeasibility_details: {
        reason: "NO_FEASIBLE_CANDIDATES",
        ranked_relaxations: [
          { field: "min_expected_savings_cents", suggested_value: "0" },
          { field: "max_downside_loss_cents", suggested_value: "6300" },
        ],
      },
    });
    const frontier = JSON.parse(
      (await harness.objectStore.get(`optimizer-runs/${fixture.runId}/frontier.json`)).toString(
        "utf8",
      ),
    );
    expect(frontier.summary).toMatchObject({
      candidate_count: 1,
      feasible_count: 0,
      best_expected_savings_cents: "0",
      lowest_p95_downside_loss_cents: "6300",
    });
    expect(JSON.stringify({ frontier, stored: stored.rows[0] })).not.toMatch(
      /credential|password|secret|token|raw_row|stack|candidate_id/iu,
    );
  });

  it("marks snapshot/artifact failures as sanitized failed runs", async () => {
    harness = await createOptimizerRunsHarness("ccpo_optimizer_worker_failure");
    const fixture = await createQueuedRun(harness.objectStore, {
      label: "failure",
      forecastCosts: ["10000"],
      hourlyRateCents: "10",
      maxDownsideLossCents: "2000",
      minExpectedSavingsCents: "1000",
    });

    const result = await createOptimizerWorker(
      createOptimizerRunsRepository(harness.pool),
      failingObjectStore(),
    ).processNextOptimizerRun();

    expect(result).toMatchObject({
      processed: true,
      runId: fixture.runId,
      status: "failed",
      outputUri: null,
      frontierUri: null,
      recommendationCount: 0,
    });
    const failed = await harness.pool.query<{
      status: string;
      output_uri: string | null;
      frontier_uri: string | null;
      error_details: Record<string, unknown>;
    }>("SELECT status, output_uri, frontier_uri, error_details FROM optimizer_runs WHERE id = $1", [
      fixture.runId,
    ]);
    expect(failed.rows[0]).toEqual({
      status: "failed",
      output_uri: null,
      frontier_uri: null,
      error_details: { code: "OPTIMIZER_WORKER_FAILED" },
    });
    expect(JSON.stringify(failed.rows[0])).not.toMatch(/boom|secret|credential|stack/iu);
  });

  it.each([
    ["aws", "aws_reserved_instance", "AmazonEC2", "us-east-1"],
    ["azure", "azure_savings_plan", "Microsoft.Compute", "eastus"],
    ["azure", "azure_reservation", "Microsoft.Compute", "eastus2"],
    ["gcp", "gcp_committed_use_discount", "Compute Engine", "us-central1"],
  ] as const)(
    "processes a %s %s queued run through instrument-specific worker dispatch",
    async (provider, instrument, serviceCode, region) => {
      harness = await createOptimizerRunsHarness(`ccpo_optimizer_worker_${instrument}`);
      const fixture = await createQueuedRun(harness.objectStore, {
        label: instrument,
        provider,
        instrument,
        serviceCode,
        region,
        forecastCosts: ["600000", "620000", "590000"],
        hourlyRateCents: "600",
        maxDownsideLossCents: "250000",
        minExpectedSavingsCents: "1000",
      });

      const result = await createOptimizerWorker(
        createOptimizerRunsRepository(harness.pool),
        harness.objectStore,
      ).processNextOptimizerRun();

      expect(result).toMatchObject({
        processed: true,
        runId: fixture.runId,
        status: "completed",
        recommendationCount: 1,
      });

      const recommendation = await harness.pool.query<{
        provider: string;
        instrument: string;
        service_code: string;
        region: string;
        expected_savings_cents: string;
      }>(
        `SELECT provider, instrument, service_code, region, expected_savings_cents::text
           FROM recommendations
          WHERE optimizer_run_id = $1`,
        [fixture.runId],
      );
      expect(recommendation.rows[0]).toEqual({
        provider,
        instrument,
        service_code: serviceCode,
        region,
        expected_savings_cents: "162000",
      });
    },
  );
});

async function createQueuedRun(
  objectStore: ObjectStore,
  options: Readonly<{
    label: string;
    provider?: "aws" | "azure" | "gcp";
    instrument?:
      | "aws_compute_savings_plan"
      | "aws_reserved_instance"
      | "azure_savings_plan"
      | "azure_reservation"
      | "gcp_committed_use_discount";
    serviceCode?: string;
    region?: string;
    forecastCosts: readonly string[];
    hourlyRateCents: string;
    maxDownsideLossCents: string;
    minExpectedSavingsCents: string;
  }>,
): Promise<Readonly<{ runId: string; priceVersionId: string }>> {
  const provider = options.provider ?? "aws";
  const instrument = options.instrument ?? "aws_compute_savings_plan";
  const serviceCode = options.serviceCode ?? "AmazonEC2";
  const region = options.region ?? "us-east-1";
  const forecastRunId = await insertCompletedForecastRun(
    options.label,
    objectStore,
    options.forecastCosts,
    provider,
    serviceCode,
    region,
  );
  const policyId = await insertActivePolicy(
    options.label,
    instrument,
    options.maxDownsideLossCents,
    options.minExpectedSavingsCents,
  );
  const priceVersionId = await insertActivePriceVersion(
    options.label,
    provider,
    instrument,
    serviceCode,
    region,
    options.hourlyRateCents,
  );
  const response = await harness!.app.inject({
    method: "POST",
    url: "/api/optimizer-runs",
    headers: { "content-type": "application/json", "x-api-key": harness!.analystApiKey },
    payload: {
      forecast_run_id: forecastRunId,
      optimizer_policy_id: policyId,
      provider,
      instrument,
      price_table_version_ids: [priceVersionId],
    },
  });
  expect(response.statusCode).toBe(201);
  return { runId: response.json().id, priceVersionId };
}

async function insertCompletedForecastRun(
  label: string,
  objectStore: ObjectStore,
  forecastCosts: readonly string[],
  provider = "aws",
  serviceCode = "AmazonEC2",
  region = "us-east-1",
): Promise<string> {
  const model = await harness!.pool.query<{ id: string }>(
    `INSERT INTO forecast_models
       (tenant_id, name, provider_scope, service_scope, horizon_months, method, config, status)
     VALUES ($1, $2, ARRAY[$3]::text[], ARRAY[$4]::text[], 12, 'seasonal_naive', '{}', 'draft')
     RETURNING id`,
    [harness!.tenantA, `${label}-model`, provider, serviceCode],
  );
  await harness!.pool.query("UPDATE forecast_models SET status = 'active' WHERE id = $1", [
    model.rows[0]!.id,
  ]);
  const run = await harness!.pool.query<{ id: string }>(
    `INSERT INTO forecast_runs
       (tenant_id, forecast_model_id, input_window_start, input_window_end, horizon_months,
        random_seed)
     VALUES ($1, $2, '2026-01-01', '2026-03-31', 3, 20260826)
     RETURNING id`,
    [harness!.tenantA, model.rows[0]!.id],
  );
  const outputUri = `forecasts/${run.rows[0]!.id}/seasonal-naive-v1.json`;
  await objectStore.put(
    outputUri,
    Buffer.from(
      `${JSON.stringify({
        schema_version: "forecast_distribution:seasonal_naive:v1",
        forecast_run_id: run.rows[0]!.id,
        forecast_model_id: model.rows[0]!.id,
        method: "seasonal_naive",
        random_seed: "20260826",
        quality_metrics: { confidence: "high", warnings: [] },
        forecast_points: forecastCosts.map((cost, index) => ({
          month: `2026-${String(index + 4).padStart(2, "0")}`,
          provider,
          service_code: serviceCode,
          region,
          forecast_on_demand_cost_cents: cost,
          basis: "all_history_average",
        })),
      })}\n`,
      "utf8",
    ),
  );
  await harness!.pool.query("UPDATE forecast_runs SET status = 'running' WHERE id = $1", [
    run.rows[0]!.id,
  ]);
  await harness!.pool.query(
    `UPDATE forecast_runs
        SET status = 'completed', output_uri = $2, quality_metrics = $3::jsonb
      WHERE id = $1`,
    [run.rows[0]!.id, outputUri, '{"confidence":"high","warnings":[]}'],
  );
  return run.rows[0]!.id;
}

async function insertActivePolicy(
  label: string,
  instrument = "aws_compute_savings_plan",
  maxDownsideLossCents: string,
  minExpectedSavingsCents: string,
): Promise<string> {
  const policy = await harness!.pool.query<{ id: string }>(
    `INSERT INTO optimizer_policies
       (tenant_id, name, objective, max_downside_loss_cents, min_expected_savings_cents,
        max_utilization_gap_pct, approval_threshold_cents, allowed_instruments, config)
     VALUES ($1, $2, 'maximize_expected_savings', $3::bigint, $4::bigint,
             25.00, 50000, ARRAY[$5]::text[],
             '{"liquidity_penalty_bps":0}'::jsonb)
     RETURNING id`,
    [
      harness!.tenantA,
      `${label}-policy`,
      maxDownsideLossCents,
      minExpectedSavingsCents,
      instrument,
    ],
  );
  await harness!.pool.query("UPDATE optimizer_policies SET status = 'active' WHERE id = $1", [
    policy.rows[0]!.id,
  ]);
  return policy.rows[0]!.id;
}

async function insertActivePriceVersion(
  label: string,
  provider = "aws",
  instrument = "aws_compute_savings_plan",
  serviceCode = "AmazonEC2",
  region = "us-east-1",
  hourlyRateCents: string,
): Promise<string> {
  const version = await harness!.pool.query<{ id: string }>(
    `INSERT INTO price_table_versions
       (tenant_id, provider, instrument, version_label, effective_from, source_uri, status, checksum)
     VALUES ($1, $2, $3, $4, '2026-08-01', $5, 'draft', $6)
     RETURNING id`,
    [
      harness!.tenantA,
      provider,
      instrument,
      `${label}-prices`,
      `prices/${label}.json`,
      `${label
        .replaceAll(/[^0-9a-f]/giu, "a")
        .padEnd(64, "a")
        .slice(0, 64)}`,
    ],
  );
  await harness!.pool.query(
    `INSERT INTO price_table_items
       (tenant_id, price_table_version_id, provider, instrument, sku, region,
        term_months, payment_option, hourly_rate_cents, upfront_cents, coverage_rules)
     VALUES ($1, $2, $3, $4, $5, $6,
             12, 'no_upfront', $7::bigint, 0, $8::jsonb)`,
    [
      harness!.tenantA,
      version.rows[0]!.id,
      provider,
      instrument,
      `${label}-sku`,
      region,
      hourlyRateCents,
      JSON.stringify({ service_code: serviceCode, usage_family: "compute", eligible: true }),
    ],
  );
  await harness!.pool.query("UPDATE price_table_versions SET status = 'active' WHERE id = $1", [
    version.rows[0]!.id,
  ]);
  return version.rows[0]!.id;
}

function failingObjectStore(): ObjectStore {
  return {
    put: async () => undefined,
    get: async () => {
      throw new Error("boom secret credential stack");
    },
    delete: async () => undefined,
    health: async () => ({ ready: true }),
    close: async () => undefined,
  };
}
