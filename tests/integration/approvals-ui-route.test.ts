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
  harness = await createRecommendationsHarness("ccpo_approvals_ui");
});

afterAll(async () => {
  await closeRecommendationsHarness(harness);
  await dropIsolatedDatabase(harness?.database);
});

describe("/approvals UI", () => {
  it("renders a tenant-scoped queue with approval decisions and safe snapshot-backed detail", async () => {
    const fixture = await createRecommendation("approvals-ui", harness.tenantA);
    const approval = await requestApproval(fixture.recommendationId);
    const foreignFixture = await createRecommendation("approvals-ui-foreign", harness.tenantB);
    await insertForeignApproval(foreignFixture.recommendationId);

    const queue = await harness.app.inject({
      method: "GET",
      url: "/approvals",
      headers: {
        accept: "text/html",
        ...recommendationsAuthorization(harness, "finance_approver", "finance_approver"),
      },
    });

    expect(queue.statusCode).toBe(200);
    expect(queue.headers["content-type"]).toContain("text/html");
    expect(queue.body).toContain("<title>Approvals | Cloud Commitment Portfolio Optimizer</title>");
    expect(queue.body).toContain("Finance approval queue");
    expect(queue.body).toContain(approval.id);
    expect(queue.body).toContain("Review decision");
    expect(queue.body).toContain("Expected net saving");
    expect(queue.body).toContain("p95 downside");
    expect(queue.body).not.toContain(foreignFixture.recommendationId);
    expect(queue.body).not.toContain(harness.tenantB);
    expect(queue.body).not.toMatch(
      /<script|approval_token|rendered_html_uri|tenant_id|key_hash|password|secret|stack|authorization|Bearer/iu,
    );

    const detail = await harness.app.inject({
      method: "GET",
      url: `/approvals/${approval.id}`,
      headers: {
        accept: "text/html",
        ...recommendationsAuthorization(harness, "finance_approver", "finance_approver"),
      },
    });

    expect(detail.statusCode).toBe(200);
    expect(detail.body).toContain("Approval decision packet");
    expect(detail.body).toContain("approval_packet:v1");
    expect(detail.body).toContain("Needs finance approval.");
    expect(detail.body).toContain('action="/approvals/');
    expect(detail.body).toContain('name="decision_reason"');
    expect(detail.body).toContain("Approve recommendation");
    expect(detail.body).toContain("Reject recommendation");
    expect(detail.body).toContain("Expected net saving");
    expect(detail.body).toContain("p95 downside");
    expect(detail.body).not.toContain(harness.tenantB);
    expect(detail.body).not.toMatch(
      /<script|approval_token|rendered_html_uri|tenant_id|key_hash|password|secret|stack|authorization|Bearer/iu,
    );
  });

  it("renders terminal approvals without decision controls and hides foreign detail", async () => {
    const fixture = await createRecommendation("approvals-ui-terminal", harness.tenantA);
    const approval = await requestApproval(fixture.recommendationId);
    const decided = await harness.app.inject({
      method: "POST",
      url: `/api/approvals/${approval.id}/reject`,
      headers: recommendationsAuthorization(harness, "finance_approver", "finance_approver"),
      payload: { decision_reason: "Rejected for terminal-state UI coverage." },
    });
    expect(decided.statusCode).toBe(200);

    const detail = await harness.app.inject({
      method: "GET",
      url: `/approvals/${approval.id}`,
      headers: {
        accept: "text/html",
        ...recommendationsAuthorization(harness, "tenant_admin", "tenant_admin"),
      },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.body).toContain("rejected");
    expect(detail.body).toContain("Rejected for terminal-state UI coverage.");
    expect(detail.body).toContain("Decision recorded");
    expect(detail.body).not.toContain("Approve recommendation");
    expect(detail.body).not.toContain("Reject recommendation");

    const foreign = await createRecommendation("approvals-ui-hidden", harness.tenantB);
    const foreignApproval = await insertForeignApproval(foreign.recommendationId);
    const hidden = await harness.app.inject({
      method: "GET",
      url: `/approvals/${foreignApproval.id}`,
      headers: {
        accept: "text/html",
        ...recommendationsAuthorization(harness, "finance_approver", "finance_approver"),
      },
    });
    expect(hidden.statusCode).toBe(404);
    expect(hidden.body).not.toContain(harness.tenantB);
  });

  it("keeps the approval UI behind Finance Approver/Admin authentication", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: "/approvals",
      headers: {
        accept: "text/html",
        ...recommendationsAuthorization(harness, "finops_analyst", "finops_analyst"),
      },
    });
    expect(response.statusCode).toBe(403);
    expect(response.body).not.toMatch(/(?:tenant_id|password|token|stack|postgres)/iu);

    const unauthenticated = await harness.app.inject({
      method: "GET",
      url: "/approvals",
      headers: { accept: "text/html" },
    });
    expect(unauthenticated.statusCode).toBe(401);
  });

  it("submits a browser form decision through the protected HTML action", async () => {
    const fixture = await createRecommendation("approvals-ui-form", harness.tenantA);
    const approval = await requestApproval(fixture.recommendationId);
    const response = await harness.app.inject({
      method: "POST",
      url: `/approvals/${approval.id}/approve`,
      headers: {
        accept: "text/html",
        "content-type": "application/x-www-form-urlencoded",
        ...recommendationsAuthorization(harness, "finance_approver", "finance_approver"),
      },
      payload: new URLSearchParams({
        decision_reason: "Approved from the finance queue.",
      }).toString(),
    });

    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe("/approvals");
    const state = await harness.pool.query<{ approval: string; recommendation: string }>(
      `SELECT
         (SELECT status FROM approvals WHERE id = $1) AS approval,
         (SELECT status FROM recommendations WHERE id = $2) AS recommendation`,
      [approval.id, fixture.recommendationId],
    );
    expect(state.rows[0]).toEqual({ approval: "approved", recommendation: "approved" });
  });
});

async function requestApproval(recommendationId: string) {
  const response = await harness.app.inject({
    method: "POST",
    url: `/api/recommendations/${recommendationId}/request-approval`,
    headers: recommendationsAuthorization(harness, "finops_analyst", "finops_analyst"),
    payload: {
      assigned_to_user_id: harness.actors.get("finance_approver"),
      reason: "Needs finance approval.",
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { id: string };
}

async function insertForeignApproval(recommendationId: string): Promise<{ id: string }> {
  const result = await harness.pool.query<{ id: string }>(
    `INSERT INTO approvals
       (tenant_id, recommendation_id, status, approval_snapshot, expires_at)
     VALUES ($1, $2, 'pending', $3::jsonb, '2026-08-27T00:00:00.000Z')
     RETURNING id`,
    [
      harness.tenantB,
      recommendationId,
      JSON.stringify({
        contract_version: "approval_packet:v1",
        tenant: { contact: { finance_owner_email: "foreign@example.invalid" } },
        recommendation: { id: recommendationId },
        approval: { status: "pending", assigned_to: null, decision_reason: null },
      }),
    ],
  );
  return { id: result.rows[0]!.id };
}

async function createRecommendation(label: string, tenantId: string) {
  const model = await harness.pool.query<{ id: string }>(
    `INSERT INTO forecast_models
       (tenant_id, name, provider_scope, service_scope, horizon_months, method, config, status)
     VALUES ($1, $2, ARRAY['aws'], ARRAY['AmazonEC2'], 12, 'seasonal_naive', '{}', 'draft')
     RETURNING id`,
    [tenantId, `${label}-${randomUUID()} model`],
  );
  await harness.pool.query("UPDATE forecast_models SET status = 'active' WHERE id = $1", [
    model.rows[0]!.id,
  ]);
  const forecast = await harness.pool.query<{ id: string }>(
    `INSERT INTO forecast_runs
       (tenant_id, forecast_model_id, input_window_start, input_window_end, horizon_months,
        random_seed, status, output_uri, quality_metrics)
     VALUES ($1, $2, '2026-01-01', '2026-03-31', 12, 20260826, 'queued', NULL, '{}')
     RETURNING id`,
    [tenantId, model.rows[0]!.id],
  );
  await harness.pool.query("UPDATE forecast_runs SET status = 'running' WHERE id = $1", [
    forecast.rows[0]!.id,
  ]);
  await harness.pool.query(
    "UPDATE forecast_runs SET status = 'completed', output_uri = $2, quality_metrics = $3::jsonb WHERE id = $1",
    [
      forecast.rows[0]!.id,
      `forecasts/${label}-${randomUUID()}/output.json`,
      '{"confidence":"high"}',
    ],
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
  const prices = await harness.pool.query<{ id: string }>(
    `INSERT INTO price_table_versions
       (tenant_id, provider, instrument, version_label, effective_from, source_uri, status, checksum)
       VALUES ($1, 'aws', 'aws_compute_savings_plan', $2, '2026-08-01', $3, 'draft', $4)
     RETURNING id`,
    [
      tenantId,
      `${label}-${randomUUID()} prices`,
      `prices/${label}-${randomUUID()}.json`,
      randomUUID().replaceAll("-", "").padEnd(64, "0").slice(0, 64),
    ],
  );
  await harness.pool.query("UPDATE price_table_versions SET status = 'active' WHERE id = $1", [
    prices.rows[0]!.id,
  ]);
  const policy = await harness.pool.query<{ id: string }>(
    `INSERT INTO optimizer_policies
       (tenant_id, name, objective, max_downside_loss_cents, min_expected_savings_cents,
        max_utilization_gap_pct, approval_threshold_cents, allowed_instruments, config, status)
     VALUES ($1, $2, 'maximize_expected_savings', 500000, 10000, 12.50, 250000,
             ARRAY['aws_compute_savings_plan']::text[], '{}', 'draft')
     RETURNING id`,
    [tenantId, `${label}-${randomUUID()} policy`],
  );
  await harness.pool.query("UPDATE optimizer_policies SET status = 'active' WHERE id = $1", [
    policy.rows[0]!.id,
  ]);
  const run = await harness.pool.query<{ id: string }>(
    `INSERT INTO optimizer_runs
       (tenant_id, forecast_run_id, optimizer_policy_id, provider, instrument,
        price_table_version_ids, random_seed, input_snapshot_uri, output_uri, frontier_uri, status)
     VALUES ($1, $2, $3, 'aws', 'aws_compute_savings_plan', $4::uuid[], 20260826,
             $5, NULL, NULL, 'queued')
     RETURNING id`,
    [
      tenantId,
      forecast.rows[0]!.id,
      policy.rows[0]!.id,
      [prices.rows[0]!.id],
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
      `optimizer-runs/${label}/output.json`,
      `optimizer-runs/${label}/frontier.json`,
    ],
  );
  const recommendation = await harness.pool.query<{ id: string }>(
    `INSERT INTO recommendations
       (tenant_id, optimizer_run_id, recommendation_type, provider, instrument, service_code,
        region, term_months, commitment_amount_cents, expected_savings_cents,
        p95_downside_loss_cents, utilization_p50_pct, utilization_p95_pct, confidence_score,
        risk_band, status, explanation, approval_required)
     VALUES ($1, $2, 'buy', 'aws', 'aws_compute_savings_plan', 'AmazonEC2', 'us-east-1', 12,
             1000000, 180000, 40000, 86.25, 94.75, 0.9400, 'low', 'pending_approval',
             '{"baseline_name":"on_demand","binding_constraints":["risk_budget"]}'::jsonb, true)
     RETURNING id`,
    [tenantId, run.rows[0]!.id],
  );
  return { recommendationId: recommendation.rows[0]!.id };
}
