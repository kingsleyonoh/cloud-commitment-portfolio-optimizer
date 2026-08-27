import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { dropIsolatedDatabase } from "./helpers/postgres-database.js";
import {
  closeOptimizerRunsHarness,
  createOptimizerRunsHarness,
  optimizerRunsAuthorization,
  type OptimizerRunsHarness,
} from "./helpers/optimizer-runs-app.js";

let harness: OptimizerRunsHarness;
let day = 1;

beforeAll(async () => {
  harness = await createOptimizerRunsHarness("ccpo_optimizer_runs_ui");
});

afterAll(async () => {
  await closeOptimizerRunsHarness(harness);
  await dropIsolatedDatabase(harness?.database);
});

describe("/optimizer-runs UI", () => {
  it("renders tenant optimizer runs with frontier and infeasible state without artifact leakage", async () => {
    await harness.pool.query("DELETE FROM recommendations");
    await harness.pool.query("DELETE FROM optimizer_runs");
    const completed = await createRunFixture("completed", harness.tenantA);
    await seedOptimizerRun({
      tenantId: harness.tenantA,
      forecastRunId: completed.forecastRunId,
      policyId: completed.policyId,
      priceVersionId: completed.priceVersionId,
      status: "completed",
      frontierUri: "optimizer-runs/visible/frontier.json",
      outputUri: "optimizer-runs/visible/output.json",
    });
    const infeasible = await createRunFixture("infeasible", harness.tenantA);
    await seedOptimizerRun({
      tenantId: harness.tenantA,
      forecastRunId: infeasible.forecastRunId,
      policyId: infeasible.policyId,
      priceVersionId: infeasible.priceVersionId,
      status: "infeasible",
      frontierUri: "optimizer-runs/infeasible/frontier.json",
      infeasibilityDetails: { code: "NO_FEASIBLE_PORTFOLIO", relaxation: "increase_risk_budget" },
    });
    const hidden = await createRunFixture("hidden", harness.tenantB);
    await seedOptimizerRun({
      tenantId: harness.tenantB,
      forecastRunId: hidden.forecastRunId,
      policyId: hidden.policyId,
      priceVersionId: hidden.priceVersionId,
      status: "completed",
      frontierUri: "optimizer-runs/hidden/frontier.json",
      outputUri: "optimizer-runs/hidden/output.json",
    });

    const response = await harness.app.inject({
      method: "GET",
      url: "/optimizer-runs",
      headers: { accept: "text/html", ...optimizerRunsAuthorization(harness) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain(
      "<title>Optimizer runs | Cloud Commitment Portfolio Optimizer</title>",
    );
    expect(response.body).toContain("Optimizer run control");
    expect(response.body).toContain("completed");
    expect(response.body).toContain("infeasible");
    expect(response.body).toContain("frontier captured");
    expect(response.body).toContain("NO_FEASIBLE_PORTFOLIO");
    expect(response.body).toContain("increase_risk_budget");
    expect(response.body).toContain("Run gate");
    expect(response.body).not.toContain("optimizer-runs/visible/frontier.json");
    expect(response.body).not.toContain("optimizer-runs/visible/output.json");
    expect(response.body).not.toContain("optimizer-runs/hidden/frontier.json");
    expect(response.body).not.toContain(harness.tenantB);
    expect(response.body).not.toMatch(
      /<script|raw_file|raw_row|key_hash|password|authorization|Bearer|stack/iu,
    );
  });

  it("lists tenant optimizer runs through the read API with status filtering", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: "/api/optimizer-runs?status=infeasible&limit=10",
      headers: { "x-api-key": harness.analystApiKey },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().optimizer_runs).toEqual([
      expect.objectContaining({
        status: "infeasible",
        infeasibility_details: {
          code: "NO_FEASIBLE_PORTFOLIO",
          relaxation: "increase_risk_budget",
        },
      }),
    ]);
    expect(response.body).not.toContain(harness.tenantB);
  });

  it("requires authentication", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: "/optimizer-runs",
      headers: { accept: "text/html" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.body).not.toMatch(
      /(?:frontier_uri|output_uri|key_hash|password|token|stack|postgres)/iu,
    );
  });
});

async function createRunFixture(label: string, tenantId: string) {
  const forecastModelId = await insertForecastModel(label, tenantId);
  const forecastRunId = await insertForecastRun(forecastModelId, tenantId);
  const policyId = await insertPolicy(label, tenantId);
  const priceVersionId = await insertPriceVersion(label, tenantId);
  return { forecastRunId, policyId, priceVersionId };
}

async function insertForecastModel(label: string, tenantId: string): Promise<string> {
  const result = await harness.pool.query<{ id: string }>(
    `INSERT INTO forecast_models
       (tenant_id, name, provider_scope, service_scope, horizon_months, method, config, status)
     VALUES ($1, $2, ARRAY['aws'], ARRAY['AmazonEC2'], 12, 'seasonal_naive', '{}', 'draft')
     RETURNING id`,
    [tenantId, `${label}-${randomUUID()} model`],
  );
  await harness.pool.query("UPDATE forecast_models SET status = 'active' WHERE id = $1", [
    result.rows[0]!.id,
  ]);
  return result.rows[0]!.id;
}

async function insertForecastRun(forecastModelId: string, tenantId: string): Promise<string> {
  const result = await harness.pool.query<{ id: string }>(
    `INSERT INTO forecast_runs
       (tenant_id, forecast_model_id, input_window_start, input_window_end, horizon_months, random_seed)
     VALUES ($1, $2, '2026-01-01', '2026-03-31', 12, 20260826)
     RETURNING id`,
    [tenantId, forecastModelId],
  );
  await harness.pool.query("UPDATE forecast_runs SET status = 'running' WHERE id = $1", [
    result.rows[0]!.id,
  ]);
  await harness.pool.query(
    `UPDATE forecast_runs
        SET status = 'completed',
            output_uri = $2,
            quality_metrics = '{"confidence":"high"}'::jsonb
      WHERE id = $1`,
    [result.rows[0]!.id, `forecasts/${result.rows[0]!.id}/output.json`],
  );
  return result.rows[0]!.id;
}

async function insertPolicy(label: string, tenantId: string): Promise<string> {
  const result = await harness.pool.query<{ id: string }>(
    `INSERT INTO optimizer_policies
       (tenant_id, name, objective, max_downside_loss_cents, min_expected_savings_cents,
        max_utilization_gap_pct, approval_threshold_cents, allowed_instruments, config)
     VALUES ($1, $2, 'maximize_expected_savings', 500000, 10000, 12.50, 250000,
             ARRAY['aws_compute_savings_plan']::text[], '{"liquidity_penalty_bps":100}'::jsonb)
     RETURNING id`,
    [tenantId, `${label}-${randomUUID()} policy`],
  );
  await harness.pool.query("UPDATE optimizer_policies SET status = 'active' WHERE id = $1", [
    result.rows[0]!.id,
  ]);
  return result.rows[0]!.id;
}

async function insertPriceVersion(label: string, tenantId: string): Promise<string> {
  const currentDay = String(day++).padStart(2, "0");
  const result = await harness.pool.query<{ id: string }>(
    `INSERT INTO price_table_versions
       (tenant_id, provider, instrument, version_label, effective_from, effective_to,
        source_uri, status, checksum)
     VALUES ($1, 'aws', 'aws_compute_savings_plan', $2, $3::date, $3::date, $4, 'draft', $5)
     RETURNING id`,
    [
      tenantId,
      `${label}-${randomUUID()} prices`,
      `2026-08-${currentDay}`,
      `prices/${label}-${currentDay}.json`,
      randomUUID().replaceAll("-", "").padEnd(64, "0").slice(0, 64),
    ],
  );
  await harness.pool.query("UPDATE price_table_versions SET status = 'active' WHERE id = $1", [
    result.rows[0]!.id,
  ]);
  return result.rows[0]!.id;
}

async function seedOptimizerRun(input: {
  tenantId: string;
  forecastRunId: string;
  policyId: string;
  priceVersionId: string;
  status: "completed" | "infeasible";
  frontierUri: string;
  outputUri?: string;
  infeasibilityDetails?: Record<string, unknown>;
}): Promise<string> {
  const id = randomUUID();
  await harness.pool.query(
    `INSERT INTO optimizer_runs
       (id, tenant_id, forecast_run_id, optimizer_policy_id, provider, instrument,
        price_table_version_ids, random_seed, input_snapshot_uri)
     VALUES ($1, $2, $3, $4, 'aws', 'aws_compute_savings_plan', $5::uuid[], 20260826, $6)`,
    [
      id,
      input.tenantId,
      input.forecastRunId,
      input.policyId,
      [input.priceVersionId],
      `optimizer-runs/${id}/input.json`,
    ],
  );
  await harness.pool.query("UPDATE optimizer_runs SET status = 'running' WHERE id = $1", [id]);
  if (input.status === "completed") {
    await harness.pool.query(
      `UPDATE optimizer_runs
          SET status = 'completed', output_uri = $2, frontier_uri = $3
        WHERE id = $1`,
      [id, input.outputUri, input.frontierUri],
    );
  } else {
    await harness.pool.query(
      `UPDATE optimizer_runs
          SET status = 'infeasible', frontier_uri = $2, infeasibility_details = $3::jsonb
        WHERE id = $1`,
      [id, input.frontierUri, JSON.stringify(input.infeasibilityDetails ?? {})],
    );
  }
  return id;
}
