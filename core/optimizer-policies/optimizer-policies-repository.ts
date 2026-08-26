import type { Pool, QueryResultRow } from "pg";

import type {
  OptimizerPolicyCreateInput,
  OptimizerPolicyListInput,
  OptimizerPolicyPatchInput,
  OptimizerPolicyRecord,
} from "./optimizer-policies-types.js";

export interface OptimizerPoliciesRepository {
  create(tenantId: string, input: OptimizerPolicyCreateInput): Promise<OptimizerPolicyRecord>;
  list(tenantId: string, input: OptimizerPolicyListInput): Promise<OptimizerPolicyRecord[]>;
  patch(
    tenantId: string,
    id: string,
    input: OptimizerPolicyPatchInput,
  ): Promise<OptimizerPolicyRecord | null>;
}

interface OptimizerPolicyRow extends QueryResultRow {
  id: string;
  name: string;
  objective: OptimizerPolicyRecord["objective"];
  maxDownsideLossCents: string;
  minExpectedSavingsCents: string;
  maxUtilizationGapPct: string;
  approvalThresholdCents: string;
  allowedInstruments: OptimizerPolicyRecord["allowedInstruments"];
  config: Record<string, unknown>;
  status: OptimizerPolicyRecord["status"];
  createdAt: string;
  updatedAt: string;
}

const PROJECTION = `id, name, objective,
  max_downside_loss_cents::text AS "maxDownsideLossCents",
  min_expected_savings_cents::text AS "minExpectedSavingsCents",
  to_char(max_utilization_gap_pct, 'FM990.00') AS "maxUtilizationGapPct",
  approval_threshold_cents::text AS "approvalThresholdCents",
  allowed_instruments AS "allowedInstruments", config, status,
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt",
  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt"`;

export function createOptimizerPoliciesRepository(pool: Pool): OptimizerPoliciesRepository {
  return {
    create: (tenantId, input) => create(pool, tenantId, input),
    list: (tenantId, input) => list(pool, tenantId, input),
    patch: (tenantId, id, input) => patch(pool, tenantId, id, input),
  };
}

async function create(
  pool: Pool,
  tenantId: string,
  input: OptimizerPolicyCreateInput,
): Promise<OptimizerPolicyRecord> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO optimizer_policies
       (tenant_id, name, objective, max_downside_loss_cents, min_expected_savings_cents,
        max_utilization_gap_pct, approval_threshold_cents, allowed_instruments, config)
     VALUES ($1, $2, $3, $4::bigint, $5::bigint, $6::numeric, $7::bigint, $8::text[], $9::jsonb)
     RETURNING id`,
    [
      tenantId,
      input.name,
      input.objective,
      input.maxDownsideLossCents,
      input.minExpectedSavingsCents,
      input.maxUtilizationGapPct,
      input.approvalThresholdCents,
      input.allowedInstruments,
      JSON.stringify(input.config),
    ],
  );
  return (await get(pool, tenantId, result.rows[0]!.id))!;
}

async function list(
  pool: Pool,
  tenantId: string,
  input: OptimizerPolicyListInput,
): Promise<OptimizerPolicyRecord[]> {
  const result = await pool.query<OptimizerPolicyRow>(
    `SELECT ${PROJECTION}
       FROM optimizer_policies
      WHERE tenant_id = $1
        AND ($2::text IS NULL OR status = $2)
        AND ($3::timestamptz IS NULL OR (created_at, id) < ($3::timestamptz, $4::uuid))
      ORDER BY created_at DESC, id DESC
      LIMIT $5`,
    [
      tenantId,
      input.status ?? null,
      input.cursor?.createdAt ?? null,
      input.cursor?.id ?? null,
      input.limit + 1,
    ],
  );
  return result.rows.map(freezeRow);
}

async function patch(
  pool: Pool,
  tenantId: string,
  id: string,
  input: OptimizerPolicyPatchInput,
): Promise<OptimizerPolicyRecord | null> {
  const result = await pool.query<{ id: string }>(
    `UPDATE optimizer_policies
        SET name = COALESCE($3::text, name),
            objective = COALESCE($4::text, objective),
            max_downside_loss_cents = COALESCE($5::bigint, max_downside_loss_cents),
            min_expected_savings_cents = COALESCE($6::bigint, min_expected_savings_cents),
            max_utilization_gap_pct = COALESCE($7::numeric, max_utilization_gap_pct),
            approval_threshold_cents = COALESCE($8::bigint, approval_threshold_cents),
            allowed_instruments = COALESCE($9::text[], allowed_instruments),
            config = COALESCE($10::jsonb, config),
            status = COALESCE($11::text, status)
      WHERE tenant_id = $1 AND id = $2
      RETURNING id`,
    [
      tenantId,
      id,
      input.name ?? null,
      input.objective ?? null,
      input.maxDownsideLossCents ?? null,
      input.minExpectedSavingsCents ?? null,
      input.maxUtilizationGapPct ?? null,
      input.approvalThresholdCents ?? null,
      input.allowedInstruments ?? null,
      input.config === undefined ? null : JSON.stringify(input.config),
      input.status ?? null,
    ],
  );
  if (result.rowCount !== 1) return null;
  return await get(pool, tenantId, id);
}

async function get(
  pool: Pool,
  tenantId: string,
  id: string,
): Promise<OptimizerPolicyRecord | null> {
  const result = await pool.query<OptimizerPolicyRow>(
    `SELECT ${PROJECTION}
       FROM optimizer_policies
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id],
  );
  return result.rows[0] ? freezeRow(result.rows[0]) : null;
}

function freezeRow(row: OptimizerPolicyRow): OptimizerPolicyRecord {
  return Object.freeze({
    id: row.id,
    name: row.name,
    objective: row.objective,
    maxDownsideLossCents: row.maxDownsideLossCents,
    minExpectedSavingsCents: row.minExpectedSavingsCents,
    maxUtilizationGapPct: row.maxUtilizationGapPct,
    approvalThresholdCents: row.approvalThresholdCents,
    allowedInstruments: Object.freeze([...row.allowedInstruments]),
    config: Object.freeze({ ...row.config }),
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
