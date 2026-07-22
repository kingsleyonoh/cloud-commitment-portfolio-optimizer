import { Client } from "pg";

import { insertImportTenant, insertImportUser } from "./import-batches-schema.js";

export interface ForecastModelInput {
  name: string;
  providerScope: string[];
  serviceScope: string[];
  horizonMonths: string;
  method: string;
  config: string;
  status: string;
}

export interface ForecastRunInput {
  status: string;
  inputWindowStart: string;
  inputWindowEnd: string;
  horizonMonths: string;
  randomSeed: string;
  outputUri: string | null;
  qualityMetrics: string;
  errorDetails: string;
}

export const validForecastModel: ForecastModelInput = {
  name: "Synthetic seasonal model",
  providerScope: ["aws"],
  serviceScope: ["synthetic-compute"],
  horizonMonths: "12",
  method: "seasonal_naive",
  config: '{"seasonality":"monthly"}',
  status: "draft",
};

export const validForecastRun: ForecastRunInput = {
  status: "queued",
  inputWindowStart: "2025-01-01",
  inputWindowEnd: "2025-12-31",
  horizonMonths: "12",
  randomSeed: "20260716",
  outputUri: null,
  qualityMetrics: "{}",
  errorDetails: "{}",
};

export async function insertForecastTenant(client: Client, label: string): Promise<string> {
  return insertImportTenant(client, label);
}

export async function insertForecastUser(
  client: Client,
  tenantId: string,
  label: string,
): Promise<string> {
  return insertImportUser(client, tenantId, label);
}

export async function insertForecastModel(
  client: Client,
  tenantId: string,
  createdByUserId: string | null,
  overrides: Partial<ForecastModelInput> = {},
) {
  const model = { ...validForecastModel, ...overrides };
  return client.query<{ id: string; status: string; created_at: Date; updated_at: Date }>(
    `INSERT INTO forecast_models
       (tenant_id, name, provider_scope, service_scope, horizon_months, method,
        config, status, created_by_user_id)
     VALUES ($1, $2, $3::text[], $4::text[], $5, $6, $7::jsonb, $8, $9)
     RETURNING id, status, created_at, updated_at`,
    [
      tenantId,
      model.name,
      model.providerScope,
      model.serviceScope,
      model.horizonMonths,
      model.method,
      model.config,
      model.status,
      createdByUserId,
    ],
  );
}

export async function insertForecastRun(
  client: Client,
  tenantId: string,
  forecastModelId: string,
  overrides: Partial<ForecastRunInput> = {},
) {
  const run = { ...validForecastRun, ...overrides };
  return client.query<{ id: string; status: string; random_seed: string }>(
    `INSERT INTO forecast_runs
       (tenant_id, forecast_model_id, status, input_window_start, input_window_end,
        horizon_months, random_seed, output_uri, quality_metrics, error_details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb)
     RETURNING id, status, random_seed`,
    [
      tenantId,
      forecastModelId,
      run.status,
      run.inputWindowStart,
      run.inputWindowEnd,
      run.horizonMonths,
      run.randomSeed,
      run.outputUri,
      run.qualityMetrics,
      run.errorDetails,
    ],
  );
}
