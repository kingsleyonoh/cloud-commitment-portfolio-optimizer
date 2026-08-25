import { Client } from "pg";

import {
  insertForecastModel,
  insertForecastRun,
  insertForecastTenant,
  insertForecastUser,
} from "./forecast-schema.js";
import { insertPriceItem, insertPriceVersion } from "./price-tables-schema.js";

export async function insertOptimizerTenant(client: Client, label: string): Promise<string> {
  return insertForecastTenant(client, label);
}

export async function insertCompletedForecastRun(
  client: Client,
  tenantId: string,
  label: string,
): Promise<string> {
  const userId = await insertForecastUser(client, tenantId, `${label}-forecaster`);
  const model = await insertForecastModel(client, tenantId, userId, {
    name: `${label} model`,
  });
  await client.query("UPDATE forecast_models SET status = 'active' WHERE id = $1", [
    model.rows[0]!.id,
  ]);
  const run = await insertForecastRun(client, tenantId, model.rows[0]!.id, {
    inputWindowStart: "2025-01-01",
    inputWindowEnd: "2025-12-31",
  });
  await client.query("UPDATE forecast_runs SET status = 'running' WHERE id = $1", [
    run.rows[0]!.id,
  ]);
  await client.query(
    `UPDATE forecast_runs
     SET status = 'completed',
         output_uri = $2,
         quality_metrics = '{"confidence":"high","mape":"0.0400"}'::jsonb
     WHERE id = $1`,
    [run.rows[0]!.id, `forecasts/${label}/output.parquet`],
  );
  return run.rows[0]!.id;
}

export async function insertActivePriceVersion(
  client: Client,
  tenantId: string,
  label: string,
): Promise<string> {
  const version = await insertPriceVersion(client, tenantId, {
    versionLabel: `${label}-prices`,
    checksum: "b".repeat(63) + label.slice(-1).padStart(1, "0"),
  });
  await insertPriceItem(client, tenantId, version.rows[0]!.id, { sku: `${label}-sku` });
  await client.query("UPDATE price_table_versions SET status = 'active' WHERE id = $1", [
    version.rows[0]!.id,
  ]);
  return version.rows[0]!.id;
}

export async function insertScenario(client: Client, tenantId: string, label: string) {
  return client.query<{ id: string; status: string }>(
    `INSERT INTO scenarios (tenant_id, name, description, shock_config, status)
     VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING id, status`,
    [tenantId, `${label} scenario`, "Synthetic demand shock", '{"demand":"base"}', "draft"],
  );
}

export async function insertOptimizerPolicy(client: Client, tenantId: string, label: string) {
  return client.query<{ id: string; status: string }>(
    `INSERT INTO optimizer_policies
       (tenant_id, name, objective, max_downside_loss_cents, min_expected_savings_cents,
        max_utilization_gap_pct, approval_threshold_cents, allowed_instruments, config, status)
     VALUES ($1, $2, 'maximize_expected_savings', 500000, 10000, 12.50, 250000,
             ARRAY['aws_compute_savings_plan']::text[], '{"liquidity_penalty_bps":100}'::jsonb,
             'draft')
     RETURNING id, status`,
    [tenantId, `${label} policy`],
  );
}

export async function insertOptimizerRun(
  client: Client,
  tenantId: string,
  forecastRunId: string,
  policyId: string,
  priceVersionIds: string[],
  scenarioId: string | null = null,
) {
  return client.query<{ id: string; status: string }>(
    `INSERT INTO optimizer_runs
       (tenant_id, forecast_run_id, scenario_id, optimizer_policy_id, provider, instrument,
        price_table_version_ids, random_seed, input_snapshot_uri, created_by_user_id)
     VALUES ($1, $2, $3, $4, 'aws', 'aws_compute_savings_plan', $5::uuid[],
             20260722, $6, NULL)
     RETURNING id, status`,
    [tenantId, forecastRunId, scenarioId, policyId, priceVersionIds, `optimizer/${tenantId}.json`],
  );
}

export async function insertRecommendation(
  client: Client,
  tenantId: string,
  optimizerRunId: string,
) {
  return client.query<{ id: string; status: string }>(
    `INSERT INTO recommendations
       (tenant_id, optimizer_run_id, recommendation_type, provider, instrument, service_code,
        region, term_months, commitment_amount_cents, expected_savings_cents,
        p95_downside_loss_cents, utilization_p50_pct, utilization_p95_pct, confidence_score,
        risk_band, status, explanation, approval_required)
     VALUES ($1, $2, 'buy', 'aws', 'aws_compute_savings_plan', 'AmazonEC2',
             'us-east-1', 12, 1000000, 180000, 40000, 86.25, 94.75, 0.9400,
             'low', 'draft', '{"binding_constraints":["risk_budget"]}'::jsonb, false)
     RETURNING id, status`,
    [tenantId, optimizerRunId],
  );
}
