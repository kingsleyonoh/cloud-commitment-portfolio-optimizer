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
  harness = await createRecommendationsHarness("ccpo_recommendations_route");
});

afterAll(async () => {
  await closeRecommendationsHarness(harness);
  await dropIsolatedDatabase(harness?.database);
});

describe("GET /api/recommendations", () => {
  it("lists same-tenant recommendations with filters and API-key access", async () => {
    const first = await createRecommendation("list-low", harness.tenantA, {
      expectedSavingsCents: "180000",
      riskBand: "low",
      status: "ready",
    });
    await createRecommendation("list-high", harness.tenantA, {
      expectedSavingsCents: "90000",
      riskBand: "high",
      status: "pending_approval",
      approvalRequired: true,
    });
    await createRecommendation("foreign", harness.tenantB, {
      expectedSavingsCents: "999999",
      riskBand: "low",
      status: "ready",
    });

    const response = await harness.app.inject({
      method: "GET",
      url: "/api/recommendations?status=ready&risk_band=low&limit=1",
      headers: { "x-api-key": harness.analystApiKey },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      recommendations: [
        {
          id: first.recommendationId,
          optimizer_run_id: first.runId,
          recommendation_type: "buy",
          provider: "aws",
          instrument: "aws_compute_savings_plan",
          service_code: "AmazonEC2",
          expected_savings_cents: "180000",
          risk_band: "low",
          status: "ready",
        },
      ],
    });
    expect(response.json().next_cursor).toBeNull();
    expect(response.body).not.toContain(harness.tenantB);
    expect(response.body).not.toMatch(/tenant_id|credential|password|secret|token|raw_row|stack/iu);
  });
});

describe("GET /api/recommendations/{id}", () => {
  it("returns recommendation detail and hides foreign identifiers", async () => {
    const fixture = await createRecommendation("detail", harness.tenantA);
    const response = await harness.app.inject({
      method: "GET",
      url: `/api/recommendations/${fixture.recommendationId}`,
      headers: recommendationsAuthorization(harness, "finops_analyst", "finops_analyst"),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      recommendation: {
        id: fixture.recommendationId,
        optimizer_run_id: fixture.runId,
        expected_savings_cents: "180000",
        p95_downside_loss_cents: "40000",
        confidence_score: "0.9400",
      },
      report_summary: null,
    });

    const foreign = await createRecommendation("foreign-detail", harness.tenantB);
    const hidden = await harness.app.inject({
      method: "GET",
      url: `/api/recommendations/${foreign.recommendationId}`,
      headers: recommendationsAuthorization(harness),
    });
    expect(hidden.statusCode).toBe(404);
    expect(hidden.body).not.toContain(harness.tenantB);
  });

  it("returns and reports a P2 provider/instrument recommendation", async () => {
    const fixture = await createRecommendation("p2-detail", harness.tenantA, {
      provider: "azure",
      instrument: "azure_reservation",
      serviceCode: "Microsoft.Compute",
      region: "eastus",
      expectedSavingsCents: "220000",
    });

    const detail = await harness.app.inject({
      method: "GET",
      url: `/api/recommendations/${fixture.recommendationId}`,
      headers: { "x-api-key": harness.analystApiKey },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().recommendation).toMatchObject({
      provider: "azure",
      instrument: "azure_reservation",
      service_code: "Microsoft.Compute",
      region: "eastus",
      expected_savings_cents: "220000",
    });

    const report = await harness.app.inject({
      method: "GET",
      url: `/api/reports/recommendation/${fixture.recommendationId}`,
      headers: { "x-api-key": harness.analystApiKey },
    });
    expect(report.statusCode).toBe(200);
    expect(report.json().snapshot.recommendation).toMatchObject({
      provider: "azure",
      instrument: "azure_reservation",
      expected_savings: "220000",
    });
    expect(report.json().rendered_html).toContain("azure_reservation");
  });
});

describe("approval workflow API", () => {
  it("lets an analyst request approval for a pending approval recommendation with a frozen packet", async () => {
    const fixture = await createRecommendation("approval-request", harness.tenantA, {
      status: "pending_approval",
      approvalRequired: true,
      expectedSavingsCents: "350000",
      riskBand: "medium",
    });
    const assignedTo = harness.actors.get("finance_approver")!;

    const response = await harness.app.inject({
      method: "POST",
      url: `/api/recommendations/${fixture.recommendationId}/request-approval`,
      headers: { "x-api-key": harness.analystApiKey },
      payload: {
        assigned_to_user_id: assignedTo,
        reason: "Monthly commitment exceeds auto-approval threshold.",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      recommendation_id: fixture.recommendationId,
      status: "pending",
      requested_by_user_id: null,
      assigned_to_user_id: assignedTo,
      workflow_execution_id: null,
      decision_reason: null,
      expires_at: "2026-08-27T00:00:00.000000Z",
      approval_snapshot: {
        contract_version: "approval_packet:v1",
        tenant: {
          contact: {
            email: "finance@example.invalid",
            finance_owner_email: "finops@example.invalid",
          },
        },
        recommendation: {
          id: fixture.recommendationId,
          expected_savings_cents: "350000",
          risk_band: "medium",
        },
        approval: {
          status: "pending",
          assigned_to: expect.stringContaining("finance_approver-"),
          decision_reason: null,
          request_reason: "Monthly commitment exceeds auto-approval threshold.",
        },
      },
    });
    expect(response.body).not.toMatch(
      /approval_token|tenant_id|credential|password|secret|token|raw_row|stack/iu,
    );

    const duplicate = await harness.app.inject({
      method: "POST",
      url: `/api/recommendations/${fixture.recommendationId}/request-approval`,
      headers: recommendationsAuthorization(harness, "finops_analyst", "finops_analyst"),
      payload: { assigned_to_user_id: assignedTo, reason: "Duplicate request" },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe("APPROVAL_STATE_INVALID");
  });

  it("rejects non-approval recommendations, cross-tenant assignees, and unknown body fields", async () => {
    const ready = await createRecommendation("approval-ready", harness.tenantA, {
      status: "ready",
      approvalRequired: false,
    });
    const foreignUser = await insertForeignApprover();

    for (const payload of [
      { assigned_to_user_id: harness.actors.get("finance_approver")!, reason: "not required" },
      { assigned_to_user_id: foreignUser, reason: "foreign" },
      { reason: "unknown", unknown: true },
    ]) {
      const response = await harness.app.inject({
        method: "POST",
        url: `/api/recommendations/${ready.recommendationId}/request-approval`,
        headers: recommendationsAuthorization(harness, "finops_analyst", "finops_analyst"),
        payload,
      });
      expect([400, 404, 409]).toContain(response.statusCode);
      expect(response.body).not.toContain(harness.tenantB);
    }
  });

  it("lists and reads approval details for approvers while denying API-key approval reads", async () => {
    const fixture = await createRecommendation("approval-list", harness.tenantA, {
      status: "pending_approval",
      approvalRequired: true,
    });
    const approval = await requestApproval(fixture.recommendationId);
    const foreignFixture = await createRecommendation("approval-list-hidden", harness.tenantB, {
      status: "pending_approval",
      approvalRequired: true,
    });
    await insertApprovalRow(foreignFixture.recommendationId, harness.tenantB);

    const list = await harness.app.inject({
      method: "GET",
      url: `/api/approvals?status=pending&recommendation_id=${fixture.recommendationId}&limit=1`,
      headers: recommendationsAuthorization(harness, "finance_approver", "finance_approver"),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({
      approvals: [{ id: approval.id, recommendation_id: fixture.recommendationId }],
      next_cursor: null,
    });
    expect(list.body).not.toContain(harness.tenantB);

    const detail = await harness.app.inject({
      method: "GET",
      url: `/api/approvals/${approval.id}`,
      headers: recommendationsAuthorization(harness, "finance_approver", "finance_approver"),
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      approval: { id: approval.id, status: "pending" },
      recommendation: { id: fixture.recommendationId, status: "pending_approval" },
    });

    const apiKeyRead = await harness.app.inject({
      method: "GET",
      url: `/api/approvals/${approval.id}`,
      headers: { "x-api-key": harness.analystApiKey },
    });
    expect(apiKeyRead.statusCode).toBe(403);
  });

  it("approves and rejects through Finance Approver/Admin roles with atomic recommendation state updates", async () => {
    const approveFixture = await createRecommendation("approval-approve", harness.tenantA, {
      status: "pending_approval",
      approvalRequired: true,
    });
    const approval = await requestApproval(approveFixture.recommendationId);

    const approved = await harness.app.inject({
      method: "POST",
      url: `/api/approvals/${approval.id}/approve`,
      headers: recommendationsAuthorization(harness, "finance_approver", "finance_approver"),
      payload: { decision_reason: "Approved within risk budget." },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({
      approval: {
        id: approval.id,
        status: "approved",
        decision_reason: "Approved within risk budget.",
      },
      recommendation: { id: approveFixture.recommendationId, status: "approved" },
    });

    const secondDecision = await harness.app.inject({
      method: "POST",
      url: `/api/approvals/${approval.id}/reject`,
      headers: recommendationsAuthorization(harness),
      payload: { decision_reason: "Changing a terminal decision is not allowed." },
    });
    expect(secondDecision.statusCode).toBe(409);

    const rejectFixture = await createRecommendation("approval-reject", harness.tenantA, {
      status: "pending_approval",
      approvalRequired: true,
    });
    const rejection = await requestApproval(rejectFixture.recommendationId);
    const rejected = await harness.app.inject({
      method: "POST",
      url: `/api/approvals/${rejection.id}/reject`,
      headers: recommendationsAuthorization(harness),
      payload: { decision_reason: "Contract term is not acceptable." },
    });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().recommendation.status).toBe("rejected");

    for (const headers of [
      recommendationsAuthorization(harness, "finops_analyst", "finops_analyst"),
      { "x-api-key": harness.analystApiKey },
    ]) {
      const denied = await harness.app.inject({
        method: "POST",
        url: `/api/approvals/${rejection.id}/approve`,
        headers,
        payload: { decision_reason: "Denied before mutation." },
      });
      expect(denied.statusCode).toBe(403);
    }
  });
});

describe("GET /api/reports/{source_type}/{source_id}", () => {
  it("captures and renders a recommendation report snapshot without approval tokens", async () => {
    const fixture = await createRecommendation("report", harness.tenantA);

    const response = await harness.app.inject({
      method: "GET",
      url: `/api/reports/recommendation/${fixture.recommendationId}`,
      headers: { "x-api-key": harness.analystApiKey },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      report_snapshot: {
        source_type: "recommendation",
        source_id: fixture.recommendationId,
        status: "rendered",
      },
      rendered_html: expect.stringContaining("Recommendation report"),
    });
    expect(response.json().report_snapshot.rendered_html_uri).toMatch(
      /^reports\/recommendation\/[0-9a-f-]+\/recommendation_report_v1\.html$/u,
    );
    expect(response.json().snapshot).toMatchObject({
      template_id: "recommendation_report:v1",
      tenant: {
        contact: {
          finance_owner_email: "finops@example.invalid",
        },
      },
      recommendation: {
        id: fixture.recommendationId,
        type: "buy",
        expected_savings: "180000",
        p95_downside_loss: "40000",
      },
      approval: { status: "not_required" },
    });
    expect(response.json().rendered_html).toContain("Finance owner:");
    expect(response.body).not.toMatch(
      /approval_token|tenant_id|credential|password|secret|token|raw_row|stack/iu,
    );

    const second = await harness.app.inject({
      method: "GET",
      url: `/api/reports/recommendation/${fixture.recommendationId}`,
      headers: { "x-api-key": harness.analystApiKey },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().report_snapshot.id).toBe(response.json().report_snapshot.id);
    expect(second.json().snapshot).toEqual(response.json().snapshot);

    const detail = await harness.app.inject({
      method: "GET",
      url: `/api/recommendations/${fixture.recommendationId}`,
      headers: { "x-api-key": harness.analystApiKey },
    });
    expect(detail.json().report_summary).toMatchObject({
      id: response.json().report_snapshot.id,
      status: "rendered",
      rendered_html_uri: response.json().report_snapshot.rendered_html_uri,
    });
  });

  it("reuses the frozen rendered snapshot after live recommendation inputs change", async () => {
    const fixture = await createRecommendation("report-freeze", harness.tenantA);
    const first = await harness.app.inject({
      method: "GET",
      url: `/api/reports/recommendation/${fixture.recommendationId}`,
      headers: recommendationsAuthorization(harness),
    });
    expect(first.statusCode).toBe(200);

    await harness.pool.query(
      `UPDATE recommendations
          SET status = 'superseded'
        WHERE id = $1`,
      [fixture.recommendationId],
    );
    await harness.pool.query(
      `UPDATE tenants
          SET display_name = 'Changed Tenant',
              finance_owner_email = 'changed-finance@example.invalid'
        WHERE id = $1`,
      [harness.tenantA],
    );

    const second = await harness.app.inject({
      method: "GET",
      url: `/api/reports/recommendation/${fixture.recommendationId}`,
      headers: recommendationsAuthorization(harness),
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().report_snapshot.id).toBe(first.json().report_snapshot.id);
    expect(second.json().snapshot).toEqual(first.json().snapshot);
    expect(second.json().rendered_html).toBe(first.json().rendered_html);
    expect(second.body).not.toContain("Changed Tenant");
    expect(second.body).not.toContain("changed-finance@example.invalid");
  });

  it("rejects unsupported report sources and hides foreign recommendations", async () => {
    const foreign = await createRecommendation("foreign-report", harness.tenantB);
    const hidden = await harness.app.inject({
      method: "GET",
      url: `/api/reports/recommendation/${foreign.recommendationId}`,
      headers: recommendationsAuthorization(harness),
    });
    expect(hidden.statusCode).toBe(404);

    const unsupported = await harness.app.inject({
      method: "GET",
      url: `/api/reports/approval/${randomUUID()}`,
      headers: recommendationsAuthorization(harness),
    });
    expect(unsupported.statusCode).toBe(400);
  });
});

async function createRecommendation(
  label: string,
  tenantId: string,
  overrides: Partial<{
    provider: "aws" | "azure" | "gcp";
    instrument:
      | "aws_compute_savings_plan"
      | "aws_reserved_instance"
      | "azure_savings_plan"
      | "azure_reservation"
      | "gcp_committed_use_discount";
    serviceCode: string;
    region: string;
    expectedSavingsCents: string;
    riskBand: "low" | "medium" | "high" | "blocked";
    status: "ready" | "pending_approval";
    approvalRequired: boolean;
  }> = {},
): Promise<Readonly<{ runId: string; recommendationId: string }>> {
  const provider = overrides.provider ?? "aws";
  const instrument = overrides.instrument ?? "aws_compute_savings_plan";
  const serviceCode = overrides.serviceCode ?? "AmazonEC2";
  const region = overrides.region ?? "us-east-1";
  const forecastModel = await harness.pool.query<{ id: string }>(
    `INSERT INTO forecast_models
       (tenant_id, name, provider_scope, service_scope, horizon_months, method, config, status)
     VALUES ($1, $2, ARRAY[$3]::text[], ARRAY[$4]::text[], 12, 'seasonal_naive', '{}', 'draft')
     RETURNING id`,
    [tenantId, `${label}-${randomUUID()} model`, provider, serviceCode],
  );
  await harness.pool.query("UPDATE forecast_models SET status = 'active' WHERE id = $1", [
    forecastModel.rows[0]!.id,
  ]);
  const forecastRun = await harness.pool.query<{ id: string }>(
    `INSERT INTO forecast_runs
       (tenant_id, forecast_model_id, input_window_start, input_window_end, horizon_months,
        random_seed)
     VALUES ($1, $2, '2026-01-01', '2026-03-31', 12, 20260826)
     RETURNING id`,
    [tenantId, forecastModel.rows[0]!.id],
  );
  await harness.pool.query("UPDATE forecast_runs SET status = 'running' WHERE id = $1", [
    forecastRun.rows[0]!.id,
  ]);
  await harness.pool.query(
    `UPDATE forecast_runs
        SET status = 'completed',
            output_uri = $2,
            quality_metrics = '{"confidence":"high","warnings":[]}'::jsonb
      WHERE id = $1`,
    [forecastRun.rows[0]!.id, `forecasts/${forecastRun.rows[0]!.id}/seasonal-naive-v1.json`],
  );
  const priceVersion = await harness.pool.query<{ id: string }>(
    `INSERT INTO price_table_versions
       (tenant_id, provider, instrument, version_label, effective_from, source_uri, status, checksum)
     VALUES ($1, $2, $3, $4, '2026-08-01', $5, 'draft', $6)
     RETURNING id`,
    [
      tenantId,
      provider,
      instrument,
      `${label}-${randomUUID()} prices`,
      `prices/${label}.json`,
      randomUUID().replaceAll("-", "").padEnd(64, "0").slice(0, 64),
    ],
  );
  await harness.pool.query(
    `INSERT INTO price_table_items
       (tenant_id, price_table_version_id, provider, instrument, sku, region,
        term_months, payment_option, hourly_rate_cents, upfront_cents, coverage_rules)
     VALUES ($1, $2, $3, $4, $5, $6,
             12, 'no_upfront', 10, 0, $7::jsonb)`,
    [
      tenantId,
      priceVersion.rows[0]!.id,
      provider,
      instrument,
      `${label}-sku`,
      region,
      JSON.stringify({ service_code: serviceCode, usage_family: "compute" }),
    ],
  );
  await harness.pool.query(
    `UPDATE price_table_versions
        SET status = 'superseded'
      WHERE tenant_id = $1
        AND provider = $2
        AND instrument = $3
        AND status = 'active'`,
    [tenantId, provider, instrument],
  );
  await harness.pool.query("UPDATE price_table_versions SET status = 'active' WHERE id = $1", [
    priceVersion.rows[0]!.id,
  ]);
  const policy = await harness.pool.query<{ id: string }>(
    `INSERT INTO optimizer_policies
       (tenant_id, name, objective, max_downside_loss_cents, min_expected_savings_cents,
        max_utilization_gap_pct, approval_threshold_cents, allowed_instruments, config)
     VALUES ($1, $2, 'maximize_expected_savings', 500000, 10000, 12.50, 250000,
             ARRAY[$3]::text[], '{"liquidity_penalty_bps":100}'::jsonb)
     RETURNING id`,
    [tenantId, `${label}-${randomUUID()} policy`, instrument],
  );
  await harness.pool.query("UPDATE optimizer_policies SET status = 'active' WHERE id = $1", [
    policy.rows[0]!.id,
  ]);
  const run = await harness.pool.query<{ id: string }>(
    `INSERT INTO optimizer_runs
       (tenant_id, forecast_run_id, optimizer_policy_id, provider, instrument,
        price_table_version_ids, random_seed, input_snapshot_uri, output_uri, frontier_uri, status)
     VALUES ($1, $2, $3, $4, $5, $6::uuid[], 20260826,
             $7, $8, $9, 'queued')
     RETURNING id`,
    [
      tenantId,
      forecastRun.rows[0]!.id,
      policy.rows[0]!.id,
      provider,
      instrument,
      [priceVersion.rows[0]!.id],
      `optimizer-runs/${label}/input.json`,
      null,
      null,
    ],
  );
  await harness.pool.query("UPDATE optimizer_runs SET status = 'running' WHERE id = $1", [
    run.rows[0]!.id,
  ]);
  await harness.pool.query(
    `UPDATE optimizer_runs
        SET status = 'completed',
            output_uri = $2,
            frontier_uri = $3
      WHERE id = $1`,
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
          selected_expected_savings_cents: overrides.expectedSavingsCents ?? "180000",
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
     VALUES ($1, $2, 'buy', $3, $4, $5,
             $6, 12, 1000000, $7::bigint, 40000, 86.25, 94.75, 0.9400,
             $8, $9, '{"baseline_name":"on_demand","binding_constraints":["risk_budget"],"price_table_version_ids":[]}'::jsonb, $10)
     RETURNING id`,
    [
      tenantId,
      run.rows[0]!.id,
      provider,
      instrument,
      serviceCode,
      region,
      overrides.expectedSavingsCents ?? "180000",
      overrides.riskBand ?? "low",
      overrides.status ?? "ready",
      overrides.approvalRequired ?? false,
    ],
  );
  return { runId: run.rows[0]!.id, recommendationId: recommendation.rows[0]!.id };
}

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

async function insertApprovalRow(recommendationId: string, tenantId: string): Promise<void> {
  await harness.pool.query(
    `INSERT INTO approvals
       (tenant_id, recommendation_id, status, approval_snapshot, expires_at)
     VALUES ($1, $2, 'pending', $3::jsonb, '2026-08-27T00:00:00.000Z')`,
    [
      tenantId,
      recommendationId,
      JSON.stringify({
        contract_version: "approval_packet:v1",
        tenant: { contact: { finance_owner_email: "foreign@example.invalid" } },
        recommendation: { id: recommendationId },
        approval: { status: "pending", assigned_to: null, decision_reason: null },
      }),
    ],
  );
}

async function insertForeignApprover(): Promise<string> {
  return (
    await harness.pool.query<{ id: string }>(
      `INSERT INTO users (tenant_id, email, name, role)
       VALUES ($1, $2, 'Foreign Approver', 'finance_approver')
       RETURNING id`,
      [harness.tenantB, `foreign-approver-${randomUUID()}@example.invalid`],
    )
  ).rows[0]!.id;
}
