import type { Pool, QueryResultRow } from "pg";

import type { AuditListInput, AuditRecord } from "./audit-types.js";

export interface AuditRepository {
  list(tenantId: string, input: AuditListInput): Promise<AuditRecord[]>;
}

interface AuditRow extends QueryResultRow {
  id: string;
  actorUserId: string | null;
  actorType: AuditRecord["actorType"];
  action: string;
  entityType: string;
  entityId: string | null;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  requestId: string | null;
  createdAt: string;
}

const PROJECTION = `id, actor_user_id AS "actorUserId", actor_type AS "actorType", action,
  entity_type AS "entityType", entity_id AS "entityId", old_values AS "oldValues",
  new_values AS "newValues", request_id AS "requestId",
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt"`;

export function createAuditRepository(pool: Pool): AuditRepository {
  return { list: (tenantId, input) => list(pool, tenantId, input) };
}

async function list(pool: Pool, tenantId: string, input: AuditListInput): Promise<AuditRecord[]> {
  const result = await pool.query<AuditRow>(
    `SELECT ${PROJECTION}
       FROM audit_log
      WHERE tenant_id = $1
        AND ($2::text IS NULL OR action = $2)
        AND ($3::text IS NULL OR actor_type = $3)
        AND ($4::text IS NULL OR entity_type = $4)
        AND ($5::uuid IS NULL OR entity_id = $5)
        AND ($6::timestamptz IS NULL OR (created_at, id) < ($6::timestamptz, $7::uuid))
      ORDER BY created_at DESC, id DESC
      LIMIT $8`,
    [
      tenantId,
      input.action ?? null,
      input.actorType ?? null,
      input.entityType ?? null,
      input.entityId ?? null,
      input.cursor?.createdAt ?? null,
      input.cursor?.id ?? null,
      input.limit + 1,
    ],
  );
  return result.rows.map(freezeRow);
}

function freezeRow(row: AuditRow): AuditRecord {
  return Object.freeze({
    id: row.id,
    actorUserId: row.actorUserId,
    actorType: row.actorType,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    oldValues: row.oldValues ? Object.freeze({ ...row.oldValues }) : null,
    newValues: row.newValues ? Object.freeze({ ...row.newValues }) : null,
    requestId: row.requestId,
    createdAt: row.createdAt,
  });
}
