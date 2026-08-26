import type { Pool, QueryResultRow } from "pg";

import type { ScenarioCreateInput, ScenarioListInput, ScenarioRecord } from "./scenarios-types.js";

export interface ScenariosRepository {
  list(tenantId: string, input: ScenarioListInput): Promise<ScenarioRecord[]>;
  get(tenantId: string, id: string): Promise<ScenarioRecord | null>;
  create(tenantId: string, createdByUserId: string, input: ScenarioCreateInput): Promise<ScenarioRecord>;
}

interface ScenarioRow extends QueryResultRow {
  id: string;
  name: string;
  description: string | null;
  baseForecastRunId: string | null;
  shockConfig: Record<string, unknown>;
  status: ScenarioRecord["status"];
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

const PROJECTION = `id, name, description, base_forecast_run_id AS "baseForecastRunId",
  shock_config AS "shockConfig", status, created_by_user_id AS "createdByUserId",
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt",
  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt"`;

export function createScenariosRepository(pool: Pool): ScenariosRepository {
  return {
    list: (tenantId, input) => list(pool, tenantId, input),
    get: (tenantId, id) => get(pool, tenantId, id),
    create: (tenantId, createdByUserId, input) => create(pool, tenantId, createdByUserId, input),
  };
}

async function list(pool: Pool, tenantId: string, input: ScenarioListInput): Promise<ScenarioRecord[]> {
  const result = await pool.query<ScenarioRow>(
    `SELECT ${PROJECTION}
       FROM scenarios
      WHERE tenant_id = $1
        AND ($2::text IS NULL OR status = $2)
        AND ($3::timestamptz IS NULL OR (created_at, id) < ($3::timestamptz, $4::uuid))
      ORDER BY created_at DESC, id DESC
      LIMIT $5`,
    [tenantId, input.status ?? null, input.cursor?.createdAt ?? null, input.cursor?.id ?? null, input.limit + 1],
  );
  return result.rows.map(freezeRow);
}

async function get(pool: Pool, tenantId: string, id: string): Promise<ScenarioRecord | null> {
  const result = await pool.query<ScenarioRow>(
    `SELECT ${PROJECTION} FROM scenarios WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id],
  );
  return result.rows[0] ? freezeRow(result.rows[0]) : null;
}

async function create(
  pool: Pool,
  tenantId: string,
  createdByUserId: string,
  input: ScenarioCreateInput,
): Promise<ScenarioRecord> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO scenarios
       (tenant_id, name, description, base_forecast_run_id, shock_config, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     RETURNING id`,
    [tenantId, input.name, input.description ?? null, input.baseForecastRunId ?? null, JSON.stringify(input.shockConfig), createdByUserId],
  );
  return (await get(pool, tenantId, result.rows[0]!.id))!;
}

function freezeRow(row: ScenarioRow): ScenarioRecord {
  return Object.freeze({
    id: row.id,
    name: row.name,
    description: row.description,
    baseForecastRunId: row.baseForecastRunId,
    shockConfig: Object.freeze({ ...row.shockConfig }),
    status: row.status,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
