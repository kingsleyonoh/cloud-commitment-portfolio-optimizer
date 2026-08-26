import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { createForecastWorker } from "../../core/forecasting/forecast-worker.js";
import { createLocalObjectStore, type ObjectStore } from "../../core/shared/objectStore.js";
import { dropIsolatedDatabase } from "./helpers/postgres-database.js";
import {
  closeForecastHarness,
  createForecastHarness,
  forecastAuthorization,
  type ForecastHarness,
} from "./helpers/forecast-app.js";

let harness: ForecastHarness | undefined;
let objectRoot: string | undefined;

afterEach(async () => {
  await closeForecastHarness(harness);
  await dropIsolatedDatabase(harness?.database);
  harness = undefined;
  if (objectRoot) await rm(objectRoot, { recursive: true, force: true });
  objectRoot = undefined;
});

describe("forecast worker", () => {
  it("claims a queued seasonal-naive run, writes a deterministic artifact, and completes metrics", async () => {
    harness = await createForecastHarness("ccpo_forecast_worker_complete");
    objectRoot = await mkdtemp(join(tmpdir(), "ccpo-forecast-worker-"));
    const objectStore = createLocalObjectStore(objectRoot);
    const model = await postModel(harness, "worker complete");
    const run = await postRun(harness, model.json().id, {
      input_window_start: "2026-01-01",
      input_window_end: "2026-03-31",
      horizon_months: 3,
      random_seed: "12345",
    });
    await insertUsageMonth(harness, "2026-01-01", "1000");
    await insertUsageMonth(harness, "2026-02-01", "3000");
    await insertUsageMonth(harness, "2026-03-01", "5000");

    const worker = createForecastWorker(harness.forecastRepository, objectStore, {
      minHistoryDays: 90,
    });
    const result = await worker.processNextForecastRun();

    expect(result).toMatchObject({
      processed: true,
      runId: run.json().id,
      status: "completed",
      outputUri: `forecasts/${run.json().id}/seasonal-naive-v1.json`,
      warnings: [],
    });
    const completed = await getRun(harness, run.json().id);
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({
      status: "completed",
      output_uri: `forecasts/${run.json().id}/seasonal-naive-v1.json`,
      quality_metrics: {
        method: "seasonal_naive",
        history_days: 90,
        monthly_observations: 3,
        source_line_items: 3,
        forecast_points: 3,
        confidence: "high",
        warnings: [],
      },
      error_details: {},
    });

    const artifact = JSON.parse(
      (await objectStore.get(`forecasts/${run.json().id}/seasonal-naive-v1.json`)).toString("utf8"),
    );
    expect(artifact).toMatchObject({
      schema_version: "forecast_distribution:seasonal_naive:v1",
      forecast_run_id: run.json().id,
      forecast_model_id: model.json().id,
      method: "seasonal_naive",
      random_seed: "12345",
    });
    expect(artifact.forecast_points).toEqual([
      {
        month: "2026-04",
        provider: "aws",
        service_code: "AmazonEC2",
        region: "us-east-1",
        forecast_on_demand_cost_cents: "3000",
        basis: "all_history_average",
      },
      {
        month: "2026-05",
        provider: "aws",
        service_code: "AmazonEC2",
        region: "us-east-1",
        forecast_on_demand_cost_cents: "3000",
        basis: "all_history_average",
      },
      {
        month: "2026-06",
        provider: "aws",
        service_code: "AmazonEC2",
        region: "us-east-1",
        forecast_on_demand_cost_cents: "3000",
        basis: "all_history_average",
      },
    ]);
    await expect(worker.processNextForecastRun()).resolves.toEqual({ processed: false });
  });

  it("completes low-history forecasts with warnings instead of failing", async () => {
    harness = await createForecastHarness("ccpo_forecast_worker_low_quality");
    objectRoot = await mkdtemp(join(tmpdir(), "ccpo-forecast-worker-"));
    const objectStore = createLocalObjectStore(objectRoot);
    const model = await postModel(harness, "worker low quality");
    const run = await postRun(harness, model.json().id, {
      input_window_start: "2026-01-01",
      input_window_end: "2026-01-31",
      horizon_months: 1,
    });

    const result = await createForecastWorker(harness.forecastRepository, objectStore, {
      minHistoryDays: 90,
    }).processNextForecastRun();

    expect(result).toMatchObject({
      processed: true,
      runId: run.json().id,
      status: "completed",
      warnings: ["NO_ELIGIBLE_USAGE_HISTORY", "LOW_HISTORY_DAYS", "LOW_MONTHLY_OBSERVATIONS"],
    });
    const completed = await getRun(harness, run.json().id);
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({
      status: "completed",
      quality_metrics: {
        confidence: "low",
        warnings: ["NO_ELIGIBLE_USAGE_HISTORY", "LOW_HISTORY_DAYS", "LOW_MONTHLY_OBSERVATIONS"],
      },
      error_details: {},
    });
  });

  it("marks artifact write failures as sanitized failed runs", async () => {
    harness = await createForecastHarness("ccpo_forecast_worker_failure");
    const model = await postModel(harness, "worker failure");
    const run = await postRun(harness, model.json().id, {
      input_window_start: "2026-01-01",
      input_window_end: "2026-01-31",
      horizon_months: 1,
    });
    await insertUsageMonth(harness, "2026-01-01", "1000");

    const result = await createForecastWorker(harness.forecastRepository, failingObjectStore(), {
      minHistoryDays: 1,
    }).processNextForecastRun();

    expect(result).toMatchObject({
      processed: true,
      runId: run.json().id,
      status: "failed",
      outputUri: null,
      warnings: [],
    });
    const failed = await getRun(harness, run.json().id);
    expect(failed.statusCode).toBe(200);
    expect(failed.json()).toMatchObject({
      status: "failed",
      output_uri: null,
      quality_metrics: {},
      error_details: { code: "FORECAST_WORKER_FAILED" },
    });
    expect(failed.body).not.toMatch(/stack|secret|credential|boom/iu);
  });
});

async function postModel(harness: ForecastHarness, name: string) {
  return harness.app.inject({
    method: "POST",
    url: "/api/forecast-models",
    headers: { "content-type": "application/json", ...forecastAuthorization(harness) },
    payload: {
      name,
      provider_scope: ["aws"],
      service_scope: ["AmazonEC2"],
      horizon_months: 12,
      method: "seasonal_naive",
      config: { seasonality: "monthly" },
    },
  });
}

async function postRun(
  harness: ForecastHarness,
  forecastModelId: string,
  overrides: Record<string, unknown>,
) {
  return harness.app.inject({
    method: "POST",
    url: "/api/forecast-runs",
    headers: { "content-type": "application/json", ...forecastAuthorization(harness) },
    payload: {
      forecast_model_id: forecastModelId,
      input_window_start: "2026-01-01",
      input_window_end: "2026-03-31",
      horizon_months: 3,
      ...overrides,
    },
  });
}

async function getRun(harness: ForecastHarness, runId: string) {
  return harness.app.inject({
    method: "GET",
    url: `/api/forecast-runs/${runId}`,
    headers: { "x-api-key": harness.analystApiKey },
  });
}

async function insertUsageMonth(
  harness: ForecastHarness,
  usageStartDate: string,
  onDemandCostCents: string,
): Promise<void> {
  const account = await harness.pool.query<{ id: string }>(
    `INSERT INTO cloud_accounts
       (tenant_id, provider, external_ref, display_name, currency)
     VALUES ($1, 'aws', $2, $2, 'USD')
     RETURNING id`,
    [harness.tenantA, `forecast-worker-${usageStartDate}`],
  );
  const batch = await harness.pool.query<{ id: string }>(
    `INSERT INTO import_batches
       (tenant_id, cloud_account_id, source, format, object_uri, schema_version, status)
     VALUES ($1, $2, 'synthetic', 'csv', $3, 'synthetic_csv:v1', 'completed')
     RETURNING id`,
    [harness.tenantA, account.rows[0]!.id, `imports/forecast-worker-${usageStartDate}.csv`],
  );
  await harness.pool.query(
    `INSERT INTO usage_line_items
       (tenant_id, import_batch_id, cloud_account_id, provider, service_code, sku,
        region, usage_start, usage_end, usage_quantity, usage_unit,
        on_demand_cost_cents, realized_cost_cents, commitment_applied_cents, tags)
     VALUES ($1, $2, $3, 'aws', 'AmazonEC2', 'm7g.large',
        'us-east-1', $4::timestamptz, $4::timestamptz + interval '1 day', '1.00000000', 'Hrs',
        $5::bigint, $5::bigint, 0, '{}'::jsonb)`,
    [harness.tenantA, batch.rows[0]!.id, account.rows[0]!.id, usageStartDate, onDemandCostCents],
  );
}

function failingObjectStore(): ObjectStore {
  return {
    put: async () => {
      throw new Error("boom secret credential stack");
    },
    get: async () => Buffer.from(""),
    delete: async () => undefined,
    health: async () => ({ ready: true }),
    close: async () => undefined,
  };
}
