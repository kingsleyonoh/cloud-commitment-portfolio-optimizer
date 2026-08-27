import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { dropIsolatedDatabase } from "./helpers/postgres-database.js";
import {
  closeRecommendationsHarness,
  createRecommendationsHarness,
  recommendationsAuthorization,
  type RecommendationsHarness,
} from "./helpers/recommendations-app.js";

let harness: RecommendationsHarness;

beforeAll(async () => {
  harness = await createRecommendationsHarness("ccpo_recommendations_ui");
});

afterAll(async () => {
  await closeRecommendationsHarness(harness);
  await dropIsolatedDatabase(harness?.database);
});

describe("/recommendations/:id UI", () => {
  it("renders a CFO-facing non-approval report detail with immutable report state", async () => {
    const fixture = await createRecommendation("ui-detail", harness.tenantA);
    const report = await harness.app.inject({
      method: "GET",
      url: `/api/reports/recommendation/${fixture.recommendationId}`,
      headers: recommendationsAuthorization(harness),
    });
    expect(report.statusCode).toBe(200);

    const response = await harness.app.inject({
      method: "GET",
      url: `/recommendations/${fixture.recommendationId}`,
      headers: { accept: "text/html", ...recommendationsAuthorization(harness) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain(
      "<title>Recommendation report | Cloud Commitment Portfolio Optimizer</title>",
    );
    expect(response.body).toContain("CFO decision packet");
    expect(response.body).toContain("Expected net saving");
    expect(response.body).toContain("$1,800.00");
    expect(response.body).toContain("p95 downside");
    expect(response.body).toContain("$400.00");
    expect(response.body).toContain("AWS Compute Savings Plan");
    expect(response.body).toContain("AmazonEC2");
    expect(response.body).toContain("risk_budget");
    expect(response.body).toContain("Immutable report state");
    expect(response.body).toContain(report.json().report_snapshot.id);
    expect(response.body).toContain("rendered");
    expect(response.body).not.toContain(report.json().report_snapshot.rendered_html_uri);
    expect(response.body).not.toMatch(
      /<script|approval_token|rendered_html_uri|tenant_id|credential|password|secret|token|raw_row|stack|authorization|Bearer/iu,
    );
  });

  it("hides foreign recommendations without leaking tenant identifiers", async () => {
    const foreign = await createRecommendation("foreign-ui", harness.tenantB);
    const response = await harness.app.inject({
      method: "GET",
      url: `/recommendations/${foreign.recommendationId}`,
      headers: recommendationsAuthorization(harness),
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain(harness.tenantB);
  });

  it("requires authentication", async () => {
    const fixture = await createRecommendation("unauthenticated-ui", harness.tenantA);
    const response = await harness.app.inject({
      method: "GET",
      url: `/recommendations/${fixture.recommendationId}`,
      headers: { accept: "text/html" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.body).not.toMatch(
      /(?:rendered_html_uri|key_hash|password|token|stack|postgres)/iu,
    );
  });
});

async function createRecommendation(
  label: string,
  tenantId: string,
): Promise<Readonly<{ runId: string; recommendationId: string }>> {
  const forecastModel = await harness.pool.query<{ id: string }>(
    `INSERT INTO forecast_models
       (tenant_id, name, provider_scope, service_scope, horizon_months, method, config, status)
     VALUES ($1, $2, ARRAY['aws'], ARRAY['AmazonEC2'], 12, 'seasonal_naive', '{}', 'draft')
     RETURNING id`,
    [tenantId, `${label}-${randomUUID()} model`],
  );
  await harness.pool.query("UPDATE forecast_models SET status = 'active' WHERE id = $1", [
    forecastModel.rows[0]!.id,
  ]);
  const forecastRun = await harness.pool.query<{ id: string }>(
    `INSERT INTO forecast_runs
       (tenant_id, forecast_model_id, input_window_start, input_window_end, horizon_months, random_seed)
     VALUES ($1, $2, '2026-01-01', '2026-03-31', 12, 20260826)
     RETURNING id`,
    [tenantId, forecastModel.rows[0]!.id],
  );
  await harness.pool.query("UPDATE forecast_runs SET status = 'running' WHERE id = $1", [
    forecastRun.rows[0]!.id,
  ]);
  await harness.pool.query(
    `UPDATE forecast_runs
        SET status = 'completed', output_uri = $2, quality_metrics = '{"confidence":"high"}'::jsonb
      WHERE id = $1`,
    [forecastRun.rows[0]!.id, `forecasts/${forecastRun.rows[0]!.id}/seasonal-naive-v1.json`],
  );
  const priceVersion = await harness.pool.query<{ id: string }>(
    `INSERT INTO price_table_versions
       (tenant_id, provider, instrument, version_label, effective_from, source_uri, status, checksum)
     VALUES ($1, 'aws', 'aws_compute_savings_plan', $2, '2026-08-01', $3, 'draft', $4)
     RETURNING id`,
    [
      tenantId,
      `${label}-${randomUUID()} prices`,
      `prices/${label}.json`,
      randomUUID().replaceAll("-", "").padEnd(64, "0").slice(0, 64),
    ],
  );
  await harness.pool.query(
    `INSERT INTO price_table_items
       (tenant_id, price_table_version_id, provider, instrument, sku, region,
        term_months, payment_option, hourly_rate_cents, upfront_cents, coverage_rules)
     VALUES ($1, $2, 'aws', 'aws_compute_savings_plan', $3, 'us-east-1',
             12, 'no_upfront', 10, 0, '{"service_code":"AmazonEC2"}'::jsonb)`,
    [tenantId, priceVersion.rows[0]!.id, `${label}-sku`],
  );
  await harness.pool.query(
    `UPDATE price_table_versions
        SET status = 'superseded'
      WHERE tenant_id = $1
        AND provider = 'aws'
        AND instrument = 'aws_compute_savings_plan'
        AND status = 'active'`,
    [tenantId],
  );
  await harness.pool.query("UPDATE price_table_versions SET status = 'active' WHERE id = $1", [
    priceVersion.rows[0]!.id,
  ]);
  const policy = await harness.pool.query<{ id: string }>(
    `INSERT INTO optimizer_policies
       (tenant_id, name, objective, max_downside_loss_cents, min_expected_savings_cents,
        max_utilization_gap_pct, approval_threshold_cents, allowed_instruments, config)
     VALUES ($1, $2, 'maximize_expected_savings', 500000, 10000, 12.50, 250000,
             ARRAY['aws_compute_savings_plan']::text[], '{"liquidity_penalty_bps":100}'::jsonb)
     RETURNING id`,
    [tenantId, `${label}-${randomUUID()} policy`],
  );
  await harness.pool.query("UPDATE optimizer_policies SET status = 'active' WHERE id = $1", [
    policy.rows[0]!.id,
  ]);
  const run = await harness.pool.query<{ id: string }>(
    `INSERT INTO optimizer_runs
       (tenant_id, forecast_run_id, optimizer_policy_id, provider, instrument,
        price_table_version_ids, random_seed, input_snapshot_uri)
     VALUES ($1, $2, $3, 'aws', 'aws_compute_savings_plan', $4::uuid[], 20260826, $5)
     RETURNING id`,
    [
      tenantId,
      forecastRun.rows[0]!.id,
      policy.rows[0]!.id,
      [priceVersion.rows[0]!.id],
      `optimizer-runs/${label}/input.json`,
    ],
  );
  await harness.pool.query("UPDATE optimizer_runs SET status = 'running' WHERE id = $1", [
    run.rows[0]!.id,
  ]);
  await harness.pool.query(
    "UPDATE optimizer_runs SET status = 'completed', output_uri = $2, frontier_uri = $3 WHERE id = $1",
    [
      run.rows[0]!.id,
      `optimizer-runs/${run.rows[0]!.id}/output.json`,
      `optimizer-runs/${run.rows[0]!.id}/frontier.json`,
    ],
  );
  await harness.objectStore.put(
    `optimizer-runs/${run.rows[0]!.id}/frontier.json`,
    Buffer.from(
      `${JSON.stringify({
        schema_version: "optimizer-frontier:v1",
        optimizer_run_id: run.rows[0]!.id,
        summary: {
          candidate_count: 1,
          feasible_count: 1,
          selected_expected_savings_cents: "180000",
          selected_p95_downside_loss_cents: "40000",
        },
      })}\n`,
      "utf8",
    ),
  );
  const recommendation = await harness.pool.query<{ id: string }>(
    `INSERT INTO recommendations
       (tenant_id, optimizer_run_id, recommendation_type, provider, instrument, service_code,
        region, term_months, commitment_amount_cents, expected_savings_cents,
        p95_downside_loss_cents, utilization_p50_pct, utilization_p95_pct, confidence_score,
        risk_band, status, explanation, approval_required)
     VALUES ($1, $2, 'buy', 'aws', 'aws_compute_savings_plan', 'AmazonEC2',
             'us-east-1', 12, 1000000, 180000, 40000, 86.25, 94.75, 0.9400,
             'low', 'ready',
             '{"baseline_name":"on_demand","binding_constraints":["risk_budget"],"decision":"buy"}'::jsonb,
             false)
     RETURNING id`,
    [tenantId, run.rows[0]!.id],
  );
  return { runId: run.rows[0]!.id, recommendationId: recommendation.rows[0]!.id };
}
