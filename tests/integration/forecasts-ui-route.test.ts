import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { dropIsolatedDatabase } from "./helpers/postgres-database.js";
import {
  closeForecastHarness,
  createForecastHarness,
  forecastAuthorization,
  type ForecastHarness,
} from "./helpers/forecast-app.js";

let harness: ForecastHarness;

beforeAll(async () => {
  harness = await createForecastHarness("ccpo_forecasts_ui");
});

afterAll(async () => {
  await closeForecastHarness(harness);
  await dropIsolatedDatabase(harness?.database);
});

describe("/forecasts UI", () => {
  it("renders tenant forecast models, runs, and quality warnings without artifact leakage", async () => {
    await harness.pool.query("DELETE FROM forecast_runs");
    await harness.pool.query("DELETE FROM forecast_models");
    const visibleModel = await seedModel({
      tenantId: harness.tenantA,
      name: "Seasonal EC2 demand",
      status: "active",
    });
    await seedModel({ tenantId: harness.tenantA, name: "Draft S3 model", status: "draft" });
    const hiddenModel = await seedModel({
      tenantId: harness.tenantB,
      name: "Hidden forecast model",
      status: "active",
    });
    await seedRun({
      tenantId: harness.tenantA,
      modelId: visibleModel,
      status: "completed",
      qualityMetrics: { warning: "LOW_HISTORY", mape: "0.1200" },
      outputUri: "forecasts/tenant-a/completed.json",
    });
    await seedRun({
      tenantId: harness.tenantA,
      modelId: visibleModel,
      status: "failed",
      errorDetails: { code: "FORECAST_WORKER_FAILED" },
    });
    await seedRun({
      tenantId: harness.tenantB,
      modelId: hiddenModel,
      status: "completed",
      qualityMetrics: { warning: "HIDDEN" },
      outputUri: "forecasts/tenant-b/hidden.json",
    });

    const response = await harness.app.inject({
      method: "GET",
      url: "/forecasts",
      headers: { accept: "text/html", ...forecastAuthorization(harness) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain(
      "<title>Forecasts | Cloud Commitment Portfolio Optimizer</title>",
    );
    expect(response.body).toContain("Forecast control");
    expect(response.body).toContain("Seasonal EC2 demand");
    expect(response.body).toContain("Draft S3 model");
    expect(response.body).toContain("completed");
    expect(response.body).toContain("failed");
    expect(response.body).toContain("LOW_HISTORY");
    expect(response.body).toContain("FORECAST_WORKER_FAILED");
    expect(response.body).toContain("Run gate");
    expect(response.body).not.toContain("forecasts/tenant-a/completed.json");
    expect(response.body).not.toContain("Hidden forecast model");
    expect(response.body).not.toContain("forecasts/tenant-b/hidden.json");
    expect(response.body).not.toContain(harness.tenantB);
    expect(response.body).not.toMatch(
      /<script|raw_file|raw_row|key_hash|password|authorization|Bearer|stack/iu,
    );
  });

  it("renders FinOps run guidance without tenant-admin-only settings copy", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: "/forecasts",
      headers: {
        accept: "text/html",
        ...forecastAuthorization(harness, "finops_analyst", "finops_analyst"),
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Forecast operator controls");
    expect(response.body).not.toContain("Tenant Admin settings");
  });

  it("requires authentication", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: "/forecasts",
      headers: { accept: "text/html" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.body).not.toMatch(/(?:output_uri|key_hash|password|token|stack|postgres)/iu);
  });
});

async function seedModel(input: {
  tenantId: string;
  name: string;
  status: "draft" | "active";
}): Promise<string> {
  const result = await harness.pool.query<{ id: string }>(
    `INSERT INTO forecast_models
       (tenant_id, name, provider_scope, service_scope, horizon_months, method, config, status)
     VALUES ($1, $2, ARRAY['aws'], ARRAY['AmazonEC2'], 12, 'seasonal_naive', '{"seasonality":"monthly"}', 'draft')
     RETURNING id`,
    [input.tenantId, input.name],
  );
  const id = result.rows[0]!.id;
  if (input.status === "active") {
    await harness.pool.query("UPDATE forecast_models SET status = 'active' WHERE id = $1", [id]);
  }
  return id;
}

async function seedRun(input: {
  tenantId: string;
  modelId: string;
  status: "queued" | "completed" | "failed";
  qualityMetrics?: Record<string, unknown>;
  errorDetails?: Record<string, unknown>;
  outputUri?: string;
}): Promise<string> {
  const result = await harness.pool.query<{ id: string }>(
    `INSERT INTO forecast_runs
       (tenant_id, forecast_model_id, input_window_start, input_window_end, horizon_months, random_seed)
     VALUES ($1, $2, '2026-01-01', '2026-06-30', 12, 20260716)
     RETURNING id`,
    [input.tenantId, input.modelId],
  );
  const id = result.rows[0]!.id;
  if (input.status === "completed") {
    await harness.pool.query("UPDATE forecast_runs SET status = 'running' WHERE id = $1", [id]);
    await harness.pool.query(
      `UPDATE forecast_runs
          SET status = 'completed', output_uri = $1, quality_metrics = $2::jsonb
        WHERE id = $3`,
      [input.outputUri, JSON.stringify(input.qualityMetrics ?? { mape: "0.0000" }), id],
    );
  }
  if (input.status === "failed") {
    await harness.pool.query("UPDATE forecast_runs SET status = 'running' WHERE id = $1", [id]);
    await harness.pool.query(
      "UPDATE forecast_runs SET status = 'failed', error_details = $1::jsonb WHERE id = $2",
      [JSON.stringify(input.errorDetails ?? { code: "FORECAST_FAILED" }), id],
    );
  }
  return id;
}
