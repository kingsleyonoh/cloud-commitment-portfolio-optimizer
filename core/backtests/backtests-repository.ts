import type { Pool, QueryResultRow } from "pg";

import { AppError } from "../shared/errors.js";
import type {
  BacktestListInput,
  BacktestPolicySnapshot,
  BacktestRunRecord,
  BacktestUsageMonth,
  BacktestWorkerRun,
  BacktestSnapshotInput,
} from "./backtests-types.js";

export interface BacktestsRepository {
  policySnapshot(tenantId: string, policyId: string): Promise<BacktestPolicySnapshot | null>;
  create(tenantId: string, input: BacktestSnapshotInput): Promise<BacktestRunRecord>;
  list(tenantId: string, input: BacktestListInput): Promise<BacktestRunRecord[]>;
  get(tenantId: string, id: string): Promise<BacktestRunRecord | null>;
  claimNextQueuedBacktest(): Promise<BacktestWorkerRun | null>;
  listReplayUsageMonths(run: BacktestWorkerRun): Promise<BacktestUsageMonth[]>;
  completeBacktest(
    run: BacktestWorkerRun,
    outputUri: string,
    metrics: Record<string, unknown>,
    reportSnapshot: Record<string, unknown>,
  ): Promise<void>;
  failBacktest(runId: string, code: string): Promise<void>;
}

interface BacktestRunRow extends QueryResultRow {
  id: string;
  name: string;
  policyId: string;
  baseline: BacktestRunRecord["baseline"];
  windowStart: string;
  windowEnd: string;
  status: BacktestRunRecord["status"];
  inputSnapshotUri: string;
  outputUri: string | null;
  metrics: Record<string, unknown>;
  errorDetails: Record<string, unknown>;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

const RUN_PROJECTION = `id, name, policy_id AS "policyId", baseline,
  to_char(window_start, 'YYYY-MM-DD') AS "windowStart",
  to_char(window_end, 'YYYY-MM-DD') AS "windowEnd",
  status, input_snapshot_uri AS "inputSnapshotUri", output_uri AS "outputUri",
  metrics, error_details AS "errorDetails", created_by_user_id AS "createdByUserId",
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt",
  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt"`;

export function createBacktestsRepository(pool: Pool): BacktestsRepository {
  return {
    policySnapshot: (tenantId, policyId) => policySnapshot(pool, tenantId, policyId),
    create: (tenantId, input) => create(pool, tenantId, input),
    list: (tenantId, input) => list(pool, tenantId, input),
    get: (tenantId, id) => get(pool, tenantId, id),
    claimNextQueuedBacktest: () => claimNextQueuedBacktest(pool),
    listReplayUsageMonths: (run) => listReplayUsageMonths(pool, run),
    completeBacktest: (run, outputUri, metrics, reportSnapshot) =>
      completeBacktest(pool, run, outputUri, metrics, reportSnapshot),
    failBacktest: (runId, code) => failBacktest(pool, runId, code),
  };
}

async function policySnapshot(
  pool: Pool,
  tenantId: string,
  policyId: string,
): Promise<BacktestPolicySnapshot | null> {
  const result = await pool.query<
    QueryResultRow & {
      id: string;
      status: string;
      name: string;
      objective: string;
      maxDownsideLossCents: string;
      minExpectedSavingsCents: string;
      maxUtilizationGapPct: string;
      approvalThresholdCents: string;
      allowedInstruments: string[];
      config: Record<string, unknown>;
    }
  >(
    `SELECT id, status, name, objective,
            max_downside_loss_cents::text AS "maxDownsideLossCents",
            min_expected_savings_cents::text AS "minExpectedSavingsCents",
            to_char(max_utilization_gap_pct, 'FM990.00') AS "maxUtilizationGapPct",
            approval_threshold_cents::text AS "approvalThresholdCents",
            allowed_instruments AS "allowedInstruments", config
       FROM optimizer_policies
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, policyId],
  );
  const row = result.rows[0];
  return row
    ? Object.freeze({
        id: row.id,
        status: row.status,
        name: row.name,
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

async function create(
  pool: Pool,
  tenantId: string,
  input: BacktestSnapshotInput,
): Promise<BacktestRunRecord> {
  try {
    const result = await pool.query<BacktestRunRow>(
      `INSERT INTO backtest_runs
         (id, tenant_id, name, policy_id, baseline, window_start, window_end,
          input_snapshot_uri, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6::date, $7::date, $8, $9)
       RETURNING ${RUN_PROJECTION}`,
      [
        input.id,
        tenantId,
        input.name,
        input.policyId,
        input.baseline,
        input.windowStart,
        input.windowEnd,
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

async function list(
  pool: Pool,
  tenantId: string,
  input: BacktestListInput,
): Promise<BacktestRunRecord[]> {
  const result = await pool.query<BacktestRunRow>(
    `SELECT ${RUN_PROJECTION}
       FROM backtest_runs
      WHERE tenant_id = $1
        AND ($2::text IS NULL OR status = $2)
        AND ($3::text IS NULL OR baseline = $3)
        AND ($4::uuid IS NULL OR policy_id = $4)
      ORDER BY created_at DESC, id DESC
      LIMIT $5`,
    [tenantId, input.status ?? null, input.baseline ?? null, input.policyId ?? null, input.limit],
  );
  return result.rows.map(freezeRun);
}

async function get(pool: Pool, tenantId: string, id: string): Promise<BacktestRunRecord | null> {
  const result = await pool.query<BacktestRunRow>(
    `SELECT ${RUN_PROJECTION}
       FROM backtest_runs
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id],
  );
  return result.rows[0] ? freezeRun(result.rows[0]) : null;
}

async function claimNextQueuedBacktest(pool: Pool): Promise<BacktestWorkerRun | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const candidate = await client.query<{ id: string }>(
      `SELECT id
         FROM backtest_runs
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
    const updated = await client.query<BacktestRunRow & { tenantId: string }>(
      `UPDATE backtest_runs
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

async function listReplayUsageMonths(
  pool: Pool,
  run: BacktestWorkerRun,
): Promise<BacktestUsageMonth[]> {
  const result = await pool.query<
    QueryResultRow & {
      month: string;
      provider: BacktestUsageMonth["provider"];
      serviceCode: string;
      region: string;
      onDemandCostCents: string;
      realizedCostCents: string;
      commitmentAppliedCents: string;
      lineItemCount: number;
    }
  >(
    `SELECT to_char(date_trunc('month', usage_start AT TIME ZONE 'UTC'), 'YYYY-MM') AS month,
            provider,
            service_code AS "serviceCode",
            region,
            sum(on_demand_cost_cents)::text AS "onDemandCostCents",
            sum(realized_cost_cents)::text AS "realizedCostCents",
            sum(commitment_applied_cents)::text AS "commitmentAppliedCents",
            count(*)::int AS "lineItemCount"
       FROM usage_line_items
      WHERE tenant_id = $1
        AND usage_start >= $2::date
        AND usage_end <= ($3::date + interval '1 day')
      GROUP BY month, provider, service_code, region
      ORDER BY month ASC, provider ASC, service_code ASC, region ASC`,
    [run.tenantId, run.windowStart, run.windowEnd],
  );
  return result.rows.map((row) =>
    Object.freeze({
      month: row.month,
      provider: row.provider,
      serviceCode: row.serviceCode,
      region: row.region,
      onDemandCostCents: row.onDemandCostCents,
      realizedCostCents: row.realizedCostCents,
      commitmentAppliedCents: row.commitmentAppliedCents,
      lineItemCount: row.lineItemCount,
    }),
  );
}

async function completeBacktest(
  pool: Pool,
  run: BacktestWorkerRun,
  outputUri: string,
  metrics: Record<string, unknown>,
  reportSnapshot: Record<string, unknown>,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE backtest_runs
          SET status = 'completed',
              output_uri = $2,
              metrics = $3::jsonb,
              error_details = '{}'::jsonb
        WHERE id = $1 AND status = 'running'`,
      [run.id, outputUri, JSON.stringify(metrics)],
    );
    await client.query(
      `INSERT INTO report_snapshots
         (tenant_id, source_type, source_id, snapshot_json, created_by_user_id)
       VALUES ($1, 'backtest_run', $2, $3::jsonb, $4)`,
      [run.tenantId, run.id, JSON.stringify(reportSnapshot), run.createdByUserId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function failBacktest(pool: Pool, runId: string, code: string): Promise<void> {
  await pool.query(
    `UPDATE backtest_runs
        SET status = 'failed',
            output_uri = NULL,
            metrics = '{}'::jsonb,
            error_details = $2::jsonb
      WHERE id = $1 AND status = 'running'`,
    [runId, JSON.stringify({ code })],
  );
}

function freezeRun(row: BacktestRunRow): BacktestRunRecord {
  return Object.freeze({
    id: row.id,
    name: row.name,
    policyId: row.policyId,
    baseline: row.baseline,
    windowStart: row.windowStart,
    windowEnd: row.windowEnd,
    status: row.status,
    inputSnapshotUri: row.inputSnapshotUri,
    outputUri: row.outputUri,
    metrics: Object.freeze({ ...row.metrics }),
    errorDetails: Object.freeze({ ...row.errorDetails }),
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function inputInvalid(): AppError {
  return new AppError({
    code: "BACKTEST_INPUT_INVALID",
    message: "Backtest inputs are not eligible.",
    statusCode: 409,
    details: [],
  });
}
