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
  harness = await createForecastHarness("ccpo_forecast_routes");
});

afterAll(async () => {
  await closeForecastHarness(harness);
  await dropIsolatedDatabase(harness?.database);
});

describe("forecast model routes", () => {
  it("creates an active seasonal-naive model and lists tenant-scoped models", async () => {
    const created = await postModel(validModel("seasonal demand"));
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      name: "seasonal demand",
      provider_scope: ["aws"],
      service_scope: ["AmazonEC2"],
      horizon_months: 12,
      method: "seasonal_naive",
      config: { seasonality: "monthly" },
      status: "active",
    });
    expect(created.body).not.toMatch(/tenant_id|credential|raw_row|secret/iu);

    await harness.pool.query(
      `INSERT INTO forecast_models
         (tenant_id, name, provider_scope, service_scope, horizon_months, method, config, status)
       VALUES ($1, 'hidden model', ARRAY['aws'], ARRAY['AmazonEC2'], 12, 'seasonal_naive', '{}', 'draft')`,
      [harness.tenantB],
    );

    const list = await harness.app.inject({
      method: "GET",
      url: "/api/forecast-models?status=active&method=seasonal_naive&limit=1",
      headers: { "x-api-key": harness.analystApiKey },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().forecast_models).toHaveLength(1);
    expect(list.json().forecast_models[0].id).toBe(created.json().id);
    expect(list.body).not.toContain(harness.tenantB);
    expect(list.body).not.toContain("hidden model");
  });

  it("rejects future methods, tenant-selecting filters, and denied roles", async () => {
    for (const payload of [
      { ...validModel("future method"), method: "exponential_smoothing" },
      { ...validModel("bad provider"), provider_scope: ["azure"] },
      { ...validModel("bad config"), config: { secret: "x" } },
      { ...validModel("unknown"), unknown: true },
    ]) {
      const response = await postModel(payload);
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("VALIDATION_ERROR");
    }

    const denied = await postModel(
      validModel("approver denied"),
      forecastAuthorization(harness, "finance_approver", "finance_approver"),
    );
    expect(denied.statusCode).toBe(403);

    const badFilter = await harness.app.inject({
      method: "GET",
      url: `/api/forecast-models?tenant_id=${harness.tenantB}`,
      headers: forecastAuthorization(harness),
    });
    expect(badFilter.statusCode).toBe(400);
  });
});

describe("forecast run routes", () => {
  it("creates a queued run from an active same-tenant model and returns detail", async () => {
    const model = await postModel(validModel("run source"));
    const created = await postRun({
      forecast_model_id: model.json().id,
      input_window_start: "2026-01-01",
      input_window_end: "2026-03-31",
      horizon_months: 12,
      random_seed: "9223372036854775807",
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      forecast_model_id: model.json().id,
      status: "queued",
      input_window_start: "2026-01-01",
      input_window_end: "2026-03-31",
      horizon_months: 12,
      random_seed: "9223372036854775807",
      output_uri: null,
      quality_metrics: {},
      error_details: {},
    });
    expect(created.body).not.toMatch(/tenant_id|credential|raw_row|stack/iu);

    const detail = await harness.app.inject({
      method: "GET",
      url: `/api/forecast-runs/${created.json().id}`,
      headers: { "x-api-key": harness.analystApiKey },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().id).toBe(created.json().id);
  });

  it("lists only tenant runs with filters and stable cursor pagination", async () => {
    const model = await postModel(validModel("list run source"));
    const created = await postRun({
      forecast_model_id: model.json().id,
      input_window_start: "2026-04-01",
      input_window_end: "2026-06-30",
      horizon_months: 6,
    });
    const older = await postRun({
      forecast_model_id: model.json().id,
      input_window_start: "2026-01-01",
      input_window_end: "2026-03-31",
      horizon_months: 6,
    });
    await harness.pool.query(
      `INSERT INTO forecast_models
         (tenant_id, name, provider_scope, service_scope, horizon_months, method, config, status)
       VALUES ($1, 'hidden run model', ARRAY['aws'], ARRAY['AmazonEC2'], 12, 'seasonal_naive', '{}', 'draft')`,
      [harness.tenantB],
    );

    const first = await harness.app.inject({
      method: "GET",
      url: `/api/forecast-runs?forecast_model_id=${model.json().id}&status=queued&limit=1`,
      headers: forecastAuthorization(harness, "finops_analyst", "finops_analyst"),
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().forecast_runs).toHaveLength(1);
    expect(first.json().forecast_runs[0].id).toBe(older.json().id);
    expect(first.json().next_cursor).toEqual(expect.any(String));

    const second = await harness.app.inject({
      method: "GET",
      url: `/api/forecast-runs?status=queued&limit=1&cursor=${first.json().next_cursor}`,
      headers: { "x-api-key": harness.analystApiKey },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().forecast_runs).toHaveLength(1);
    expect(second.json().forecast_runs[0].id).toBe(created.json().id);
    expect(second.body).not.toContain(harness.tenantB);
  });

  it("rejects cross-tenant models, malformed filters, and unsupported run bodies", async () => {
    const foreign = await harness.pool.query<{ id: string }>(
      `INSERT INTO forecast_models
         (tenant_id, name, provider_scope, service_scope, horizon_months, method, config, status)
       VALUES ($1, 'foreign active model', ARRAY['aws'], ARRAY['AmazonEC2'], 12, 'seasonal_naive', '{}', 'draft')
       RETURNING id`,
      [harness.tenantB],
    );
    await harness.pool.query("UPDATE forecast_models SET status = 'active' WHERE id = $1", [
      foreign.rows[0]!.id,
    ]);
    const hidden = await postRun({
      forecast_model_id: foreign.rows[0]!.id,
      input_window_start: "2026-01-01",
      input_window_end: "2026-03-31",
      horizon_months: 12,
    });
    expect(hidden.statusCode).toBe(404);
    expect(hidden.body).not.toContain(harness.tenantB);

    for (const payload of [
      {
        forecast_model_id: foreign.rows[0]!.id,
        input_window_start: "2026-03-31",
        input_window_end: "2026-01-01",
        horizon_months: 12,
      },
      {
        forecast_model_id: "not-a-uuid",
        input_window_start: "2026-01-01",
        input_window_end: "2026-03-31",
        horizon_months: 12,
      },
      {
        forecast_model_id: foreign.rows[0]!.id,
        input_window_start: "2026-01-01",
        input_window_end: "2026-03-31",
        horizon_months: 2,
      },
    ]) {
      const response = await postRun(payload);
      expect(response.statusCode).toBe(400);
    }

    const badFilter = await harness.app.inject({
      method: "GET",
      url: "/api/forecast-runs?status=active",
      headers: forecastAuthorization(harness),
    });
    expect(badFilter.statusCode).toBe(400);

    const badCursor = Buffer.from(
      JSON.stringify({ created_at: "not-a-date", id: foreign.rows[0]!.id }),
      "utf8",
    ).toString("base64url");
    const malformedCursor = await harness.app.inject({
      method: "GET",
      url: `/api/forecast-runs?cursor=${badCursor}`,
      headers: forecastAuthorization(harness),
    });
    expect(malformedCursor.statusCode).toBe(400);
  });
});

function validModel(name: string): Record<string, unknown> {
  return {
    name,
    provider_scope: ["aws"],
    service_scope: ["AmazonEC2"],
    horizon_months: 12,
    method: "seasonal_naive",
    config: { seasonality: "monthly" },
  };
}

async function postModel(
  payload: Record<string, unknown>,
  headers = forecastAuthorization(harness),
): Promise<Awaited<ReturnType<ForecastHarness["app"]["inject"]>>> {
  return await harness.app.inject({
    method: "POST",
    url: "/api/forecast-models",
    headers: { "content-type": "application/json", ...headers },
    payload,
  });
}

async function postRun(
  payload: Record<string, unknown>,
  headers = forecastAuthorization(harness),
): Promise<Awaited<ReturnType<ForecastHarness["app"]["inject"]>>> {
  return await harness.app.inject({
    method: "POST",
    url: "/api/forecast-runs",
    headers: { "content-type": "application/json", ...headers },
    payload,
  });
}
