import type { Pool, QueryResultRow } from "pg";

import { AppError } from "../shared/errors.js";
import type {
  OptimizerRunCreateInput,
  OptimizerRunListInput,
  OptimizerRunForecastSnapshot,
  OptimizerRunPolicySnapshot,
  OptimizerPriceItem,
  OptimizerRecommendationInput,
  OptimizerRunPriceSnapshot,
  OptimizerRunRecord,
  OptimizerRunScenarioSnapshot,
  OptimizerRunSnapshotInput,
  OptimizerWorkerRun,
  ResolvedOptimizerRunInputs,
} from "./optimizer-runs-types.js";

export interface OptimizerRunsRepository {
  resolveInputs(
    tenantId: string,
    input: OptimizerRunCreateInput,
  ): Promise<ResolvedOptimizerRunInputs | null>;
  create(tenantId: string, input: OptimizerRunSnapshotInput): Promise<OptimizerRunRecord>;
  list(tenantId: string, input: OptimizerRunListInput): Promise<OptimizerRunRecord[]>;
  get(tenantId: string, id: string): Promise<OptimizerRunRecord | null>;
  claimNextQueuedOptimizerRun(): Promise<OptimizerWorkerRun | null>;
  listFrozenPriceItems(run: OptimizerWorkerRun): Promise<OptimizerPriceItem[]>;
  insertRecommendation(run: OptimizerWorkerRun, input: OptimizerRecommendationInput): Promise<void>;
  completeOptimizerRun(runId: string, outputUri: string, frontierUri: string): Promise<void>;
  markOptimizerRunInfeasible(
    runId: string,
    frontierUri: string,
    details: Record<string, unknown>,
  ): Promise<void>;
  failOptimizerRun(runId: string, code: string): Promise<void>;
}

interface OptimizerRunRow extends QueryResultRow {
  id: string;
  forecastRunId: string;
  scenarioId: string | null;
  optimizerPolicyId: string;
  provider: "aws";
  instrument: "aws_compute_savings_plan";
  priceTableVersionIds: string[];
  status: OptimizerRunRecord["status"];
  randomSeed: string;
  inputSnapshotUri: string;
  outputUri: string | null;
  frontierUri: string | null;
  infeasibilityDetails: Record<string, unknown>;
  errorDetails: Record<string, unknown>;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

const RUN_PROJECTION = `id, forecast_run_id AS "forecastRunId", scenario_id AS "scenarioId",
  optimizer_policy_id AS "optimizerPolicyId", provider, instrument,
  price_table_version_ids AS "priceTableVersionIds", status, random_seed::text AS "randomSeed",
  input_snapshot_uri AS "inputSnapshotUri", output_uri AS "outputUri", frontier_uri AS "frontierUri",
  infeasibility_details AS "infeasibilityDetails", error_details AS "errorDetails",
  created_by_user_id AS "createdByUserId",
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt",
  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt"`;

export function createOptimizerRunsRepository(pool: Pool): OptimizerRunsRepository {
  return {
    resolveInputs: (tenantId, input) => resolveInputs(pool, tenantId, input),
    create: (tenantId, input) => create(pool, tenantId, input),
    list: (tenantId, input) => list(pool, tenantId, input),
    get: (tenantId, id) => get(pool, tenantId, id),
    claimNextQueuedOptimizerRun: () => claimNextQueuedOptimizerRun(pool),
    listFrozenPriceItems: (run) => listFrozenPriceItems(pool, run),
    insertRecommendation: (run, input) => insertRecommendation(pool, run, input),
    completeOptimizerRun: (runId, outputUri, frontierUri) =>
      completeOptimizerRun(pool, runId, outputUri, frontierUri),
    markOptimizerRunInfeasible: (runId, frontierUri, details) =>
      markOptimizerRunInfeasible(pool, runId, frontierUri, details),
    failOptimizerRun: (runId, code) => failOptimizerRun(pool, runId, code),
  };
}

async function resolveInputs(
  pool: Pool,
  tenantId: string,
  input: OptimizerRunCreateInput,
): Promise<ResolvedOptimizerRunInputs | null> {
  const [forecast, policy, scenario, prices] = await Promise.all([
    forecastRun(pool, tenantId, input.forecastRunId),
    policySnapshot(pool, tenantId, input.optimizerPolicyId),
    input.scenarioId ? scenarioSnapshot(pool, tenantId, input.scenarioId) : Promise.resolve(null),
    priceSnapshots(pool, tenantId, input),
  ]);
  if (!forecast || !policy || prices === null || (input.scenarioId && !scenario)) return null;
  if (forecast.status !== "completed") throw inputInvalid();
  if (policy.status !== "active") throw inputInvalid();
  if (!policy.allowedInstruments.includes(input.instrument)) throw inputInvalid();
  if (scenario && scenario.status !== "ready") throw inputInvalid();
  if (prices.length === 0) throw inputInvalid();
  return Object.freeze({
    forecastRun: forecast,
    policy,
    scenario,
    priceTableVersions: Object.freeze(prices),
  });
}

async function create(
  pool: Pool,
  tenantId: string,
  input: OptimizerRunSnapshotInput,
): Promise<OptimizerRunRecord> {
  try {
    const result = await pool.query<OptimizerRunRow>(
      `INSERT INTO optimizer_runs
         (id, tenant_id, forecast_run_id, scenario_id, optimizer_policy_id, provider, instrument,
          price_table_version_ids, random_seed, input_snapshot_uri, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::uuid[], $9::bigint, $10, $11)
       RETURNING ${RUN_PROJECTION}`,
      [
        input.id,
        tenantId,
        input.forecastRunId,
        input.scenarioId ?? null,
        input.optimizerPolicyId,
        input.provider,
        input.instrument,
        input.priceTableVersionIds,
        input.randomSeed,
        input.inputSnapshotUri,
        input.createdByUserId,
      ],
    );
    return freezeRun(result.rows[0]!);
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error && typeof error === "object" && (error as { code?: unknown }).code === "55000") {
      throw inputInvalid();
    }
    throw error;
  }
}

async function forecastRun(
  pool: Pool,
  tenantId: string,
  id: string,
): Promise<OptimizerRunForecastSnapshot | null> {
  const result = await pool.query<
    QueryResultRow & {
      id: string;
      status: string;
      outputUri: string | null;
      qualityMetrics: Record<string, unknown>;
    }
  >(
    `SELECT id, status, output_uri AS "outputUri", quality_metrics AS "qualityMetrics"
       FROM forecast_runs
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id],
  );
  const row = result.rows[0];
  return row
    ? Object.freeze({
        id: row.id,
        status: row.status,
        outputUri: row.outputUri,
        qualityMetrics: Object.freeze({ ...row.qualityMetrics }),
      })
    : null;
}

async function policySnapshot(
  pool: Pool,
  tenantId: string,
  id: string,
): Promise<OptimizerRunPolicySnapshot | null> {
  const result = await pool.query<
    QueryResultRow & {
      id: string;
      status: string;
      objective: string;
      maxDownsideLossCents: string;
      minExpectedSavingsCents: string;
      maxUtilizationGapPct: string;
      approvalThresholdCents: string;
      allowedInstruments: string[];
      config: Record<string, unknown>;
    }
  >(
    `SELECT id, status, objective,
            max_downside_loss_cents::text AS "maxDownsideLossCents",
            min_expected_savings_cents::text AS "minExpectedSavingsCents",
            to_char(max_utilization_gap_pct, 'FM990.00') AS "maxUtilizationGapPct",
            approval_threshold_cents::text AS "approvalThresholdCents",
            allowed_instruments AS "allowedInstruments", config
       FROM optimizer_policies
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id],
  );
  const row = result.rows[0];
  return row
    ? Object.freeze({
        id: row.id,
        status: row.status,
        objective: row.objective,
        maxDownsideLossCents: row.maxDownsideLossCents,
        minExpectedSavingsCents: row.minExpectedSavingsCents,
        maxUtilizationGapPct: row.maxUtilizationGapPct,
        approvalThresholdCents: row.approvalThresholdCents,
        allowedInstruments: Object.freeze([...row.allowedInstruments]),
        config: Object.freeze({ ...row.config }),
      })
    : null;
}

async function scenarioSnapshot(
  pool: Pool,
  tenantId: string,
  id: string,
): Promise<OptimizerRunScenarioSnapshot> {
  const result = await pool.query<
    QueryResultRow & { id: string; status: string; shockConfig: Record<string, unknown> }
  >(
    `SELECT id, status, shock_config AS "shockConfig"
       FROM scenarios
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id],
  );
  const row = result.rows[0];
  return row
    ? Object.freeze({
        id: row.id,
        status: row.status,
        shockConfig: Object.freeze({ ...row.shockConfig }),
      })
    : null;
}

async function priceSnapshots(
  pool: Pool,
  tenantId: string,
  input: OptimizerRunCreateInput,
): Promise<readonly OptimizerRunPriceSnapshot[] | null> {
  const explicitIds = input.priceTableVersionIds;
  const result = await pool.query<QueryResultRow & OptimizerRunPriceSnapshot>(
    `SELECT id, status, provider, instrument, checksum,
            to_char(effective_from, 'YYYY-MM-DD') AS "effectiveFrom",
            CASE WHEN effective_to IS NULL THEN NULL ELSE to_char(effective_to, 'YYYY-MM-DD') END AS "effectiveTo"
       FROM price_table_versions
      WHERE tenant_id = $1
        AND provider = $2
        AND instrument = $3
        AND status = 'active'
        AND ($4::uuid[] IS NULL OR id = ANY($4::uuid[]))
      ORDER BY effective_from DESC, id DESC`,
    [tenantId, input.provider, input.instrument, explicitIds ?? null],
  );
  if (explicitIds && result.rowCount !== explicitIds.length) return null;
  return Object.freeze(result.rows.map((row) => Object.freeze({ ...row })));
}

async function list(
  pool: Pool,
  tenantId: string,
  input: OptimizerRunListInput,
): Promise<OptimizerRunRecord[]> {
  const result = await pool.query<OptimizerRunRow>(
    `SELECT ${RUN_PROJECTION}
       FROM optimizer_runs
      WHERE tenant_id = $1
        AND ($2::text IS NULL OR status = $2)
      ORDER BY created_at DESC, id DESC
      LIMIT $3`,
    [tenantId, input.status ?? null, input.limit],
  );
  return result.rows.map(freezeRun);
}

async function get(pool: Pool, tenantId: string, id: string): Promise<OptimizerRunRecord | null> {
  const result = await pool.query<OptimizerRunRow>(
    `SELECT ${RUN_PROJECTION}
       FROM optimizer_runs
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id],
  );
  return result.rows[0] ? freezeRun(result.rows[0]) : null;
}

async function claimNextQueuedOptimizerRun(pool: Pool): Promise<OptimizerWorkerRun | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const candidate = await client.query<{ id: string }>(
      `SELECT id
         FROM optimizer_runs
        WHERE status = 'queued'
        ORDER BY created_at ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1`,
    );
    const id = candidate.rows[0]?.id;
    if (!id) {
      await client.query("COMMIT");
      return null;
    }
    const updated = await client.query<OptimizerRunRow & { tenantId: string }>(
      `UPDATE optimizer_runs
          SET status = 'running'
        WHERE id = $1 AND status = 'queued'
        RETURNING tenant_id AS "tenantId", ${RUN_PROJECTION}`,
      [id],
    );
    await client.query("COMMIT");
    const row = updated.rows[0];
    return row ? Object.freeze({ ...freezeRun(row), tenantId: row.tenantId }) : null;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function listFrozenPriceItems(
  pool: Pool,
  run: OptimizerWorkerRun,
): Promise<OptimizerPriceItem[]> {
  const result = await pool.query<
    QueryResultRow & {
      sku: string;
      region: string;
      termMonths: number;
      paymentOption: OptimizerPriceItem["paymentOption"];
      hourlyRateCents: string;
      upfrontCents: string;
      coverageRules: Record<string, unknown>;
    }
  >(
    `SELECT sku, region, term_months AS "termMonths", payment_option AS "paymentOption",
            hourly_rate_cents::text AS "hourlyRateCents", upfront_cents::text AS "upfrontCents",
            coverage_rules AS "coverageRules"
       FROM price_table_items
      WHERE tenant_id = $1
        AND price_table_version_id = ANY($2::uuid[])
        AND provider = $3
        AND instrument = $4
      ORDER BY region ASC, sku ASC, term_months ASC, payment_option ASC`,
    [run.tenantId, run.priceTableVersionIds, run.provider, run.instrument],
  );
  return result.rows.map((row) =>
    Object.freeze({
      sku: row.sku,
      region: row.region,
      termMonths: row.termMonths,
      paymentOption: row.paymentOption,
      hourlyRateCents: row.hourlyRateCents,
      upfrontCents: row.upfrontCents,
      coverageRules: Object.freeze({ ...row.coverageRules }),
    }),
  );
}

async function insertRecommendation(
  pool: Pool,
  run: OptimizerWorkerRun,
  input: OptimizerRecommendationInput,
): Promise<void> {
  await pool.query(
    `INSERT INTO recommendations
       (tenant_id, optimizer_run_id, recommendation_type, provider, instrument, service_code,
        region, term_months, commitment_amount_cents, expected_savings_cents,
        p95_downside_loss_cents, utilization_p50_pct, utilization_p95_pct, confidence_score,
        risk_band, status, explanation, approval_required)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
             $9::bigint, $10::bigint, $11::bigint, $12::numeric, $13::numeric,
             $14::numeric, $15, $16, $17::jsonb, $18)`,
    [
      run.tenantId,
      run.id,
      input.recommendationType,
      input.provider,
      input.instrument,
      input.serviceCode,
      input.region,
      input.termMonths,
      input.commitmentAmountCents,
      input.expectedSavingsCents,
      input.p95DownsideLossCents,
      input.utilizationP50Pct,
      input.utilizationP95Pct,
      input.confidenceScore,
      input.riskBand,
      input.status,
      JSON.stringify(input.explanation),
      input.approvalRequired,
    ],
  );
}

async function completeOptimizerRun(
  pool: Pool,
  runId: string,
  outputUri: string,
  frontierUri: string,
): Promise<void> {
  await pool.query(
    `UPDATE optimizer_runs
        SET status = 'completed',
            output_uri = $2,
            frontier_uri = $3,
            infeasibility_details = '{}'::jsonb,
            error_details = '{}'::jsonb
      WHERE id = $1 AND status = 'running'`,
    [runId, outputUri, frontierUri],
  );
}

async function markOptimizerRunInfeasible(
  pool: Pool,
  runId: string,
  frontierUri: string,
  details: Record<string, unknown>,
): Promise<void> {
  await pool.query(
    `UPDATE optimizer_runs
        SET status = 'infeasible',
            output_uri = NULL,
            frontier_uri = $2,
            infeasibility_details = $3::jsonb,
            error_details = '{}'::jsonb
      WHERE id = $1 AND status = 'running'`,
    [runId, frontierUri, JSON.stringify(details)],
  );
}

async function failOptimizerRun(pool: Pool, runId: string, code: string): Promise<void> {
  await pool.query(
    `UPDATE optimizer_runs
        SET status = 'failed',
            output_uri = NULL,
            frontier_uri = NULL,
            infeasibility_details = '{}'::jsonb,
            error_details = $2::jsonb
      WHERE id = $1 AND status = 'running'`,
    [runId, JSON.stringify({ code })],
  );
}

function freezeRun(row: OptimizerRunRow): OptimizerRunRecord {
  return Object.freeze({
    id: row.id,
    forecastRunId: row.forecastRunId,
    scenarioId: row.scenarioId,
    optimizerPolicyId: row.optimizerPolicyId,
    provider: row.provider,
    instrument: row.instrument,
    priceTableVersionIds: Object.freeze([...row.priceTableVersionIds]),
    status: row.status,
    randomSeed: row.randomSeed,
    inputSnapshotUri: row.inputSnapshotUri,
    outputUri: row.outputUri,
    frontierUri: row.frontierUri,
    infeasibilityDetails: Object.freeze({ ...row.infeasibilityDetails }),
    errorDetails: Object.freeze({ ...row.errorDetails }),
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function inputInvalid(): AppError {
  return new AppError({
    code: "OPTIMIZER_RUN_INPUT_INVALID",
    message: "Optimizer run inputs are not eligible.",
    statusCode: 409,
    details: [],
  });
}
