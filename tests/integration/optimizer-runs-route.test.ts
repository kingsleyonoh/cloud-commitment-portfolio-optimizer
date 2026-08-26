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
  harness = await createOptimizerRunsHarness("ccpo_optimizer_runs_route");
});

afterAll(async () => {
  await closeOptimizerRunsHarness(harness);
  await dropIsolatedDatabase(harness?.database);
});

describe("POST /api/optimizer-runs", () => {
  it("queues an AWS Compute Savings Plan run with frozen explicit inputs and a snapshot artifact", async () => {
    const fixture = await createRunFixture("explicit");
    const response = await postRun({
      forecast_run_id: fixture.forecastRunId,
      optimizer_policy_id: fixture.policyId,
      provider: "aws",
      instrument: "aws_compute_savings_plan",
      price_table_version_ids: [fixture.priceVersionId],
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      forecast_run_id: fixture.forecastRunId,
      scenario_id: null,
      optimizer_policy_id: fixture.policyId,
      provider: "aws",
      instrument: "aws_compute_savings_plan",
      price_table_version_ids: [fixture.priceVersionId],
      status: "queued",
      random_seed: "20260826",
      output_uri: null,
      frontier_uri: null,
      infeasibility_details: {},
      error_details: {},
      created_by_user_id: harness.actors.get("tenant_admin"),
    });
    expect(response.json().input_snapshot_uri).toMatch(
      /^optimizer-runs\/[0-9a-f-]+\/input\.json$/u,
    );
    expect(response.body).not.toMatch(/tenant_id|credential|password|secret|token|raw_row|stack/iu);

    const snapshot = JSON.parse(
      (await harness.objectStore.get(response.json().input_snapshot_uri)).toString("utf8"),
    );
    expect(snapshot).toMatchObject({
      contract_version: "optimizer-run-input-snapshot/v1",
      run_id: response.json().id,
      forecast_run: { id: fixture.forecastRunId, status: "completed" },
      policy: { id: fixture.policyId, status: "active" },
      scenario: null,
      provider: "aws",
      instrument: "aws_compute_savings_plan",
      price_table_versions: [{ id: fixture.priceVersionId, status: "active" }],
      random_seed: "20260826",
    });
  });

  it("resolves default AWS CSP scope and active price versions for analyst API keys", async () => {
    const fixture = await createRunFixture("defaulted");
    const response = await postRun(
      {
        forecast_run_id: fixture.forecastRunId,
        optimizer_policy_id: fixture.policyId,
      },
      { "x-api-key": harness.analystApiKey },
    );

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      provider: "aws",
      instrument: "aws_compute_savings_plan",
      created_by_user_id: null,
    });
    expect(response.json().price_table_version_ids).toContain(fixture.priceVersionId);
  });

  it("accepts a ready same-tenant scenario and rejects draft or foreign scenarios", async () => {
    const fixture = await createRunFixture("scenario");
    const readyScenario = await insertScenario(fixture.forecastRunId, "ready");
    await harness.pool.query("UPDATE scenarios SET status = 'ready' WHERE id = $1", [
      readyScenario,
    ]);

    const accepted = await postRun({
      forecast_run_id: fixture.forecastRunId,
      scenario_id: readyScenario,
      optimizer_policy_id: fixture.policyId,
      price_table_version_ids: [fixture.priceVersionId],
    });
    expect(accepted.statusCode).toBe(201);
    expect(accepted.json().scenario_id).toBe(readyScenario);

    const draftScenario = await insertScenario(fixture.forecastRunId, "draft");
    const draft = await postRun({
      forecast_run_id: fixture.forecastRunId,
      scenario_id: draftScenario,
      optimizer_policy_id: fixture.policyId,
      price_table_version_ids: [fixture.priceVersionId],
    });
    expect(draft.statusCode).toBe(409);
    expect(draft.json().error.code).toBe("OPTIMIZER_RUN_INPUT_INVALID");

    const foreignScenario = await insertForeignScenario();
    const foreign = await postRun({
      forecast_run_id: fixture.forecastRunId,
      scenario_id: foreignScenario,
      optimizer_policy_id: fixture.policyId,
      price_table_version_ids: [fixture.priceVersionId],
    });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.body).not.toContain(harness.tenantB);
  });

  it("rejects foreign, incomplete, inactive, unsupported, and disallowed run inputs", async () => {
    const fixture = await createRunFixture("reject");
    const foreign = await createForeignFixture();
    const queuedForecast = await insertForecastRun(fixture.forecastModelId, "queued");
    const inactivePolicy = await insertPolicy("inactive", ["aws_compute_savings_plan"]);
    const disallowingPolicy = await insertPolicy("ri-only", ["aws_reserved_instance"]);

    for (const payload of [
      { forecast_run_id: foreign.forecastRunId, optimizer_policy_id: fixture.policyId },
      { forecast_run_id: queuedForecast, optimizer_policy_id: fixture.policyId },
      { forecast_run_id: fixture.forecastRunId, optimizer_policy_id: inactivePolicy },
      {
        forecast_run_id: fixture.forecastRunId,
        optimizer_policy_id: disallowingPolicy,
        instrument: "aws_compute_savings_plan",
      },
      {
        forecast_run_id: fixture.forecastRunId,
        optimizer_policy_id: fixture.policyId,
        provider: "azure",
      },
      {
        forecast_run_id: fixture.forecastRunId,
        optimizer_policy_id: fixture.policyId,
        price_table_version_ids: [foreign.priceVersionId],
      },
      {
        forecast_run_id: fixture.forecastRunId,
        optimizer_policy_id: fixture.policyId,
        price_table_version_ids: [fixture.priceVersionId],
        unknown: true,
      },
    ]) {
      const response = await postRun(payload);
      expect([400, 404, 409]).toContain(response.statusCode);
      expect(response.body).not.toContain(harness.tenantB);
    }
  });

  it("denies finance approvers and auditors before mutation", async () => {
    const fixture = await createRunFixture("denied");
    const before = await countRuns();
    for (const [actor, role] of [
      ["finance_approver", "finance_approver"],
      ["read_only_auditor", "read_only_auditor"],
    ] as const) {
      const response = await postRun(
        {
          forecast_run_id: fixture.forecastRunId,
          optimizer_policy_id: fixture.policyId,
        },
        optimizerRunsAuthorization(harness, actor, role),
      );
      expect(response.statusCode).toBe(403);
    }
    await expect(countRuns()).resolves.toBe(before);
  });
});

describe("GET /api/optimizer-runs/{id}", () => {
  it("returns the tenant run with a null frontier summary before the worker completes it", async () => {
    const fixture = await createRunFixture("detail");
    const created = await postRun({
      forecast_run_id: fixture.forecastRunId,
      optimizer_policy_id: fixture.policyId,
      price_table_version_ids: [fixture.priceVersionId],
    });

    const response = await harness.app.inject({
      method: "GET",
      url: `/api/optimizer-runs/${created.json().id}`,
      headers: { "x-api-key": harness.analystApiKey },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      optimizer_run: {
        id: created.json().id,
        status: "queued",
        input_snapshot_uri: created.json().input_snapshot_uri,
      },
      frontier_summary: null,
    });
    expect(response.body).not.toMatch(/tenant_id|credential|password|secret|token|raw_row|stack/iu);
  });

  it("hides foreign optimizer run identifiers", async () => {
    const foreign = await createForeignRun();
    const response = await harness.app.inject({
      method: "GET",
      url: `/api/optimizer-runs/${foreign}`,
      headers: optimizerRunsAuthorization(harness),
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain(harness.tenantB);
  });
});

async function createRunFixture(label: string) {
  const forecastModelId = await insertForecastModel(label);
  const forecastRunId = await insertForecastRun(forecastModelId, "completed");
  const policyId = await insertPolicy(label, ["aws_compute_savings_plan"]);
  await harness.pool.query("UPDATE optimizer_policies SET status = 'active' WHERE id = $1", [
    policyId,
  ]);
  const priceVersionId = await insertPriceVersion(label, harness.tenantA);
  return { forecastModelId, forecastRunId, policyId, priceVersionId };
}

async function createForeignFixture() {
  const forecastModelId = await insertForecastModel(`foreign-${randomUUID()}`, harness.tenantB);
  const forecastRunId = await insertForecastRun(forecastModelId, "completed", harness.tenantB);
  const priceVersionId = await insertPriceVersion(`foreign-${randomUUID()}`, harness.tenantB);
  return { forecastRunId, priceVersionId };
}

async function createForeignRun(): Promise<string> {
  const foreign = await createForeignFixture();
  const policy = await harness.pool.query<{ id: string }>(
    `INSERT INTO optimizer_policies
       (tenant_id, name, objective, max_downside_loss_cents, allowed_instruments, config)
     VALUES ($1, $2, 'maximize_expected_savings', 500000,
             ARRAY['aws_compute_savings_plan']::text[], '{}')
     RETURNING id`,
    [harness.tenantB, `foreign-run-${randomUUID()} policy`],
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
      harness.tenantB,
      foreign.forecastRunId,
      policy.rows[0]!.id,
      [foreign.priceVersionId],
      `optimizer-runs/foreign-${randomUUID()}/input.json`,
    ],
  );
  return run.rows[0]!.id;
}

async function insertForecastModel(label: string, tenantId = harness.tenantA): Promise<string> {
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

async function insertForecastRun(
  forecastModelId: string,
  status: "queued" | "completed",
  tenantId = harness.tenantA,
): Promise<string> {
  const result = await harness.pool.query<{ id: string }>(
    `INSERT INTO forecast_runs
       (tenant_id, forecast_model_id, input_window_start, input_window_end, horizon_months,
        random_seed)
     VALUES ($1, $2, '2026-01-01', '2026-03-31', 12, 20260826)
     RETURNING id`,
    [tenantId, forecastModelId],
  );
  if (status === "completed") {
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
  }
  return result.rows[0]!.id;
}

async function insertPolicy(label: string, instruments: readonly string[]): Promise<string> {
  const result = await harness.pool.query<{ id: string }>(
    `INSERT INTO optimizer_policies
       (tenant_id, name, objective, max_downside_loss_cents, min_expected_savings_cents,
        max_utilization_gap_pct, approval_threshold_cents, allowed_instruments, config)
     VALUES ($1, $2, 'maximize_expected_savings', 500000, 10000, 12.50, 250000,
             $3::text[], '{"liquidity_penalty_bps":100}'::jsonb)
     RETURNING id`,
    [harness.tenantA, `${label}-${randomUUID()} policy`, instruments],
  );
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

async function insertScenario(forecastRunId: string, label: string): Promise<string> {
  const result = await harness.pool.query<{ id: string }>(
    `INSERT INTO scenarios (tenant_id, name, base_forecast_run_id, shock_config, status)
     VALUES ($1, $2, $3, '{"demand":"base"}'::jsonb, 'draft')
     RETURNING id`,
    [harness.tenantA, `${label}-${randomUUID()} scenario`, forecastRunId],
  );
  return result.rows[0]!.id;
}

async function insertForeignScenario(): Promise<string> {
  const foreign = await createForeignFixture();
  const result = await harness.pool.query<{ id: string }>(
    `INSERT INTO scenarios (tenant_id, name, base_forecast_run_id, shock_config, status)
     VALUES ($1, $2, $3, '{"demand":"base"}'::jsonb, 'draft')
     RETURNING id`,
    [harness.tenantB, `foreign-${randomUUID()} scenario`, foreign.forecastRunId],
  );
  await harness.pool.query("UPDATE scenarios SET status = 'ready' WHERE id = $1", [
    result.rows[0]!.id,
  ]);
  return result.rows[0]!.id;
}

async function countRuns(): Promise<string> {
  const result = await harness.pool.query<{ count: string }>("SELECT count(*) FROM optimizer_runs");
  return result.rows[0]!.count;
}

async function postRun(
  payload: Record<string, unknown>,
  headers = optimizerRunsAuthorization(harness),
): Promise<Awaited<ReturnType<OptimizerRunsHarness["app"]["inject"]>>> {
  return await harness.app.inject({
    method: "POST",
    url: "/api/optimizer-runs",
    headers: { "content-type": "application/json", ...headers },
    payload,
  });
}
