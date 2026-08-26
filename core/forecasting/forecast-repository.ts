import type { Pool, PoolClient, QueryResultRow } from "pg";

import type {
  ForecastModelCreateInput,
  ForecastModelListInput,
  ForecastModelRecord,
  ForecastRunCreateInput,
  ForecastRunListInput,
  ForecastRunRecord,
  ForecastUsageMonth,
  ForecastWorkerRun,
} from "./forecast-types.js";

export interface ForecastRepository {
  createModel(
    tenantId: string,
    createdByUserId: string | null,
    input: ForecastModelCreateInput,
  ): Promise<ForecastModelRecord>;
  listModels(tenantId: string, input: ForecastModelListInput): Promise<ForecastModelRecord[]>;
  getModel(tenantId: string, id: string): Promise<ForecastModelRecord | null>;
  createRun(tenantId: string, input: ForecastRunCreateInput): Promise<ForecastRunRecord | null>;
  listRuns(tenantId: string, input: ForecastRunListInput): Promise<ForecastRunRecord[]>;
  getRun(tenantId: string, id: string): Promise<ForecastRunRecord | null>;
  claimNextQueuedRun(): Promise<ForecastWorkerRun | null>;
  listUsageMonths(run: ForecastWorkerRun): Promise<ForecastUsageMonth[]>;
  completeRun(
    runId: string,
    outputUri: string,
    qualityMetrics: Record<string, unknown>,
  ): Promise<void>;
  failRun(runId: string, code: string): Promise<void>;
}

interface ForecastModelRow extends QueryResultRow {
  id: string;
  name: string;
  providerScope: string[];
  serviceScope: string[];
  horizonMonths: number;
  method: ForecastModelRecord["method"];
  config: Record<string, unknown>;
  status: ForecastModelRecord["status"];
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ForecastRunRow extends QueryResultRow {
  id: string;
  forecastModelId: string;
  status: ForecastRunRecord["status"];
  inputWindowStart: string;
  inputWindowEnd: string;
  horizonMonths: number;
  randomSeed: string;
  outputUri: string | null;
  qualityMetrics: Record<string, unknown>;
  errorDetails: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

const MODEL_PROJECTION = `id, name, provider_scope AS "providerScope",
  service_scope AS "serviceScope", horizon_months AS "horizonMonths", method, config, status,
  created_by_user_id AS "createdByUserId",
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt",
  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt"`;

const RUN_PROJECTION = `id, forecast_model_id AS "forecastModelId", status,
  to_char(input_window_start, 'YYYY-MM-DD') AS "inputWindowStart",
  to_char(input_window_end, 'YYYY-MM-DD') AS "inputWindowEnd",
  horizon_months AS "horizonMonths", random_seed::text AS "randomSeed", output_uri AS "outputUri",
  quality_metrics AS "qualityMetrics", error_details AS "errorDetails",
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt",
  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt"`;

export function createForecastRepository(pool: Pool): ForecastRepository {
  return {
    createModel: (tenantId, createdByUserId, input) =>
      withTenantTransaction(pool, tenantId, (client) =>
        createModel(client, tenantId, createdByUserId, input),
      ),
    listModels: (tenantId, input) => listModels(pool, tenantId, input),
    getModel: (tenantId, id) => getModel(pool, tenantId, id),
    createRun: (tenantId, input) => createRun(pool, tenantId, input),
    listRuns: (tenantId, input) => listRuns(pool, tenantId, input),
    getRun: (tenantId, id) => getRun(pool, tenantId, id),
    claimNextQueuedRun: () => claimNextQueuedRun(pool),
    listUsageMonths: (run) => listUsageMonths(pool, run),
    completeRun: (runId, outputUri, qualityMetrics) =>
      completeRun(pool, runId, outputUri, qualityMetrics),
    failRun: (runId, code) => failRun(pool, runId, code),
  };
}

async function createModel(
  client: PoolClient,
  tenantId: string,
  createdByUserId: string | null,
  input: ForecastModelCreateInput,
): Promise<ForecastModelRecord> {
  const created = await client.query<{ id: string }>(
    `INSERT INTO forecast_models
       (tenant_id, name, provider_scope, service_scope, horizon_months, method, config,
        created_by_user_id)
     VALUES ($1, $2, $3::text[], $4::text[], $5, $6, $7::jsonb, $8)
     RETURNING id`,
    [
      tenantId,
      input.name,
      input.providerScope,
      input.serviceScope,
      input.horizonMonths,
      input.method,
      JSON.stringify(input.config),
      createdByUserId,
    ],
  );
  await client.query("UPDATE forecast_models SET status = 'active' WHERE id = $1", [
    created.rows[0]!.id,
  ]);
  return (await getModelWithClient(client, tenantId, created.rows[0]!.id))!;
}

async function listModels(
  pool: Pool,
  tenantId: string,
  input: ForecastModelListInput,
): Promise<ForecastModelRecord[]> {
  const result = await pool.query<ForecastModelRow>(
    `SELECT ${MODEL_PROJECTION}
       FROM forecast_models
      WHERE tenant_id = $1
        AND ($2::text IS NULL OR status = $2)
        AND ($3::text IS NULL OR method = $3)
        AND ($4::timestamptz IS NULL OR (created_at, id) < ($4::timestamptz, $5::uuid))
      ORDER BY created_at DESC, id DESC
      LIMIT $6`,
    [
      tenantId,
      input.status ?? null,
      input.method ?? null,
      input.cursor?.createdAt ?? null,
      input.cursor?.id ?? null,
      input.limit + 1,
    ],
  );
  return result.rows.map(freezeModel);
}

async function getModel(
  pool: Pool,
  tenantId: string,
  id: string,
): Promise<ForecastModelRecord | null> {
  const result = await pool.query<ForecastModelRow>(
    `SELECT ${MODEL_PROJECTION}
       FROM forecast_models
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id],
  );
  return result.rows[0] ? freezeModel(result.rows[0]) : null;
}

async function createRun(
  pool: Pool,
  tenantId: string,
  input: ForecastRunCreateInput,
): Promise<ForecastRunRecord | null> {
  try {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO forecast_runs
         (tenant_id, forecast_model_id, input_window_start, input_window_end, horizon_months,
          random_seed)
       VALUES ($1, $2, $3::date, $4::date, $5, $6::bigint)
       RETURNING id`,
      [
        tenantId,
        input.forecastModelId,
        input.inputWindowStart,
        input.inputWindowEnd,
        input.horizonMonths,
        input.randomSeed,
      ],
    );
    return await getRun(pool, tenantId, result.rows[0]!.id);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      (error as { constraint?: unknown }).constraint === "forecast_runs_tenant_model_fkey"
    ) {
      return null;
    }
    throw error;
  }
}

async function listRuns(
  pool: Pool,
  tenantId: string,
  input: ForecastRunListInput,
): Promise<ForecastRunRecord[]> {
  const result = await pool.query<ForecastRunRow>(
    `SELECT ${RUN_PROJECTION}
       FROM forecast_runs
      WHERE tenant_id = $1
        AND ($2::text IS NULL OR status = $2)
        AND ($3::uuid IS NULL OR forecast_model_id = $3)
        AND ($4::timestamptz IS NULL OR (created_at, id) < ($4::timestamptz, $5::uuid))
      ORDER BY created_at DESC, id DESC
      LIMIT $6`,
    [
      tenantId,
      input.status ?? null,
      input.forecastModelId ?? null,
      input.cursor?.createdAt ?? null,
      input.cursor?.id ?? null,
      input.limit + 1,
    ],
  );
  return result.rows.map(freezeRun);
}

async function getRun(pool: Pool, tenantId: string, id: string): Promise<ForecastRunRecord | null> {
  const result = await pool.query<ForecastRunRow>(
    `SELECT ${RUN_PROJECTION}
       FROM forecast_runs
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id],
  );
  return result.rows[0] ? freezeRun(result.rows[0]) : null;
}

async function claimNextQueuedRun(pool: Pool): Promise<ForecastWorkerRun | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const candidate = await client.query<{ id: string }>(
      `SELECT id
         FROM forecast_runs
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
    const updated = await client.query<ForecastRunRow & { tenantId: string }>(
      `UPDATE forecast_runs
          SET status = 'running'
        WHERE id = $1 AND status = 'queued'
        RETURNING tenant_id AS "tenantId", ${RUN_PROJECTION}`,
      [id],
    );
    const run = updated.rows[0];
    if (!run) {
      await client.query("COMMIT");
      return null;
    }
    const model = await client.query<ForecastModelRow & { tenantId: string }>(
      `SELECT tenant_id AS "tenantId", ${MODEL_PROJECTION}
         FROM forecast_models
        WHERE tenant_id = $1 AND id = $2`,
      [run.tenantId, run.forecastModelId],
    );
    await client.query("COMMIT");
    const modelRow = model.rows[0];
    if (!modelRow) return null;
    return freezeWorkerRun(run, modelRow);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function listUsageMonths(pool: Pool, run: ForecastWorkerRun): Promise<ForecastUsageMonth[]> {
  const result = await pool.query<
    QueryResultRow & {
      month: string;
      provider: "aws";
      serviceCode: string;
      region: string;
      onDemandCostCents: string;
      realizedCostCents: string;
      usageQuantity: string;
      lineItemCount: number;
    }
  >(
    `SELECT to_char(date_trunc('month', usage_start AT TIME ZONE 'UTC'), 'YYYY-MM') AS month,
            provider,
            service_code AS "serviceCode",
            region,
            sum(on_demand_cost_cents)::text AS "onDemandCostCents",
            sum(realized_cost_cents)::text AS "realizedCostCents",
            sum(usage_quantity)::text AS "usageQuantity",
            count(*)::int AS "lineItemCount"
       FROM usage_line_items
      WHERE tenant_id = $1
        AND provider = ANY($2::text[])
        AND service_code = ANY($3::text[])
        AND usage_start >= $4::date
        AND usage_end <= ($5::date + interval '1 day')
      GROUP BY month, provider, service_code, region
      ORDER BY month ASC, provider ASC, service_code ASC, region ASC`,
    [
      run.tenantId,
      run.model.providerScope,
      run.model.serviceScope,
      run.inputWindowStart,
      run.inputWindowEnd,
    ],
  );
  return result.rows.map((row) =>
    Object.freeze({
      month: row.month,
      provider: row.provider,
      serviceCode: row.serviceCode,
      region: row.region,
      onDemandCostCents: row.onDemandCostCents,
      realizedCostCents: row.realizedCostCents,
      usageQuantity: row.usageQuantity,
      lineItemCount: row.lineItemCount,
    }),
  );
}

async function completeRun(
  pool: Pool,
  runId: string,
  outputUri: string,
  qualityMetrics: Record<string, unknown>,
): Promise<void> {
  await pool.query(
    `UPDATE forecast_runs
        SET status = 'completed',
            output_uri = $2,
            quality_metrics = $3::jsonb,
            error_details = '{}'::jsonb
      WHERE id = $1 AND status = 'running'`,
    [runId, outputUri, JSON.stringify(qualityMetrics)],
  );
}

async function failRun(pool: Pool, runId: string, code: string): Promise<void> {
  await pool.query(
    `UPDATE forecast_runs
        SET status = 'failed',
            output_uri = NULL,
            quality_metrics = '{}'::jsonb,
            error_details = $2::jsonb
      WHERE id = $1 AND status = 'running'`,
    [runId, JSON.stringify({ code })],
  );
}

async function getModelWithClient(
  client: PoolClient,
  tenantId: string,
  id: string,
): Promise<ForecastModelRecord | null> {
  const result = await client.query<ForecastModelRow>(
    `SELECT ${MODEL_PROJECTION}
       FROM forecast_models
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id],
  );
  return result.rows[0] ? freezeModel(result.rows[0]) : null;
}

async function withTenantTransaction<T>(
  pool: Pool,
  tenantId: string,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tenant = await client.query("SELECT id FROM tenants WHERE id = $1 FOR UPDATE", [
      tenantId,
    ]);
    if (tenant.rowCount !== 1) throw new Error("Authenticated tenant vanished.");
    const value = await operation(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function freezeModel(row: ForecastModelRow): ForecastModelRecord {
  return Object.freeze({
    id: row.id,
    name: row.name,
    providerScope: Object.freeze(row.providerScope as ["aws"]),
    serviceScope: Object.freeze([...row.serviceScope]),
    horizonMonths: row.horizonMonths,
    method: row.method,
    config: Object.freeze({ ...row.config }),
    status: row.status,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function freezeRun(row: ForecastRunRow): ForecastRunRecord {
  return Object.freeze({
    id: row.id,
    forecastModelId: row.forecastModelId,
    status: row.status,
    inputWindowStart: row.inputWindowStart,
    inputWindowEnd: row.inputWindowEnd,
    horizonMonths: row.horizonMonths,
    randomSeed: row.randomSeed,
    outputUri: row.outputUri,
    qualityMetrics: Object.freeze({ ...row.qualityMetrics }),
    errorDetails: Object.freeze({ ...row.errorDetails }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function freezeWorkerRun(
  run: ForecastRunRow & { tenantId: string },
  model: ForecastModelRow & { tenantId: string },
): ForecastWorkerRun {
  return Object.freeze({
    ...freezeRun(run),
    tenantId: run.tenantId,
    model: Object.freeze({
      id: model.id,
      tenantId: model.tenantId,
      providerScope: Object.freeze(model.providerScope as ["aws"]),
      serviceScope: Object.freeze([...model.serviceScope]),
      method: model.method,
      config: Object.freeze({ ...model.config }),
    }),
  });
}
