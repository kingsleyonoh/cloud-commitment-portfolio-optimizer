import type { Pool, PoolClient, QueryResultRow } from "pg";

import type {
  ForecastModelCreateInput,
  ForecastModelListInput,
  ForecastModelRecord,
  ForecastRunCreateInput,
  ForecastRunListInput,
  ForecastRunRecord,
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
