import type { Pool, QueryResultRow } from "pg";

import type {
  EcosystemEventRecord,
  EcosystemEventStatus,
  EcosystemTarget,
} from "./ecosystem-types.js";

export interface EcosystemEventsRepository {
  enqueue(input: {
    tenantId: string;
    eventType: string;
    eventId: string;
    payload: Record<string, unknown>;
    targetSystem: EcosystemTarget;
    enabled: boolean;
  }): Promise<EcosystemEventRecord>;
  listForTenant(tenantId: string, limit: number): Promise<EcosystemEventRecord[]>;
  claimNext(now: Date): Promise<EcosystemEventRecord | null>;
  markSent(id: string): Promise<EcosystemEventRecord | null>;
  markRetry(id: string, nextAttemptAt: Date, error: string): Promise<EcosystemEventRecord | null>;
  markFailed(id: string, error: string): Promise<EcosystemEventRecord | null>;
}

interface EventRow extends QueryResultRow {
  id: string;
  tenantId: string;
  eventType: string;
  eventId: string;
  payload: Record<string, unknown>;
  status: EcosystemEventStatus;
  targetSystem: EcosystemTarget;
  nextAttemptAt: string | null;
  attemptCount: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

const PROJECTION = `id, tenant_id AS "tenantId", event_type AS "eventType", event_id AS "eventId",
  payload, status, target_system AS "targetSystem",
  to_char(next_attempt_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "nextAttemptAt",
  attempt_count AS "attemptCount", last_error AS "lastError",
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt",
  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt"`;

export function createEcosystemEventsRepository(pool: Pool): EcosystemEventsRepository {
  return {
    enqueue: (input) => enqueue(pool, input),
    listForTenant: (tenantId, limit) => listForTenant(pool, tenantId, limit),
    claimNext: (now) => claimNext(pool, now),
    markSent: (id) => markSent(pool, id),
    markRetry: (id, nextAttemptAt, error) => markRetry(pool, id, nextAttemptAt, error),
    markFailed: (id, error) => markFailed(pool, id, error),
  };
}

async function enqueue(
  pool: Pool,
  input: {
    tenantId: string;
    eventType: string;
    eventId: string;
    payload: Record<string, unknown>;
    targetSystem: EcosystemTarget;
    enabled: boolean;
  },
): Promise<EcosystemEventRecord> {
  const result = await pool.query<EventRow>(
    `INSERT INTO ecosystem_events
       (tenant_id, event_type, event_id, payload, status, target_system, next_attempt_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
     ON CONFLICT (tenant_id, target_system, event_id)
     DO UPDATE SET updated_at = ecosystem_events.updated_at
     RETURNING ${PROJECTION}`,
    [
      input.tenantId,
      input.eventType,
      input.eventId,
      JSON.stringify(input.payload),
      input.enabled ? "queued" : "disabled",
      input.targetSystem,
      input.enabled ? new Date().toISOString() : null,
    ],
  );
  return freezeEvent(result.rows[0]!);
}

async function listForTenant(
  pool: Pool,
  tenantId: string,
  limit: number,
): Promise<EcosystemEventRecord[]> {
  const result = await pool.query<EventRow>(
    `SELECT ${PROJECTION}
       FROM ecosystem_events
      WHERE tenant_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT $2`,
    [tenantId, limit],
  );
  return result.rows.map(freezeEvent);
}

async function claimNext(pool: Pool, now: Date): Promise<EcosystemEventRecord | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<EventRow>(
      `SELECT ${PROJECTION}
         FROM ecosystem_events
        WHERE status IN ('queued', 'retrying')
          AND next_attempt_at <= $1
        ORDER BY next_attempt_at ASC, created_at ASC, id ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED`,
      [now.toISOString()],
    );
    if (!result.rows[0]) {
      await client.query("COMMIT");
      return null;
    }
    const claimed = await client.query<EventRow>(
      `UPDATE ecosystem_events
          SET status = 'retrying', attempt_count = attempt_count + 1,
              next_attempt_at = clock_timestamp() + interval '5 minutes'
        WHERE id = $1
        RETURNING ${PROJECTION}`,
      [result.rows[0].id],
    );
    await client.query("COMMIT");
    return freezeEvent(claimed.rows[0]!);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function markSent(pool: Pool, id: string): Promise<EcosystemEventRecord | null> {
  const result = await pool.query<EventRow>(
    `UPDATE ecosystem_events
        SET status = 'sent', next_attempt_at = NULL, last_error = NULL
      WHERE id = $1 AND status = 'retrying'
      RETURNING ${PROJECTION}`,
    [id],
  );
  return result.rows[0] ? freezeEvent(result.rows[0]) : null;
}

async function markRetry(
  pool: Pool,
  id: string,
  nextAttemptAt: Date,
  error: string,
): Promise<EcosystemEventRecord | null> {
  const result = await pool.query<EventRow>(
    `UPDATE ecosystem_events
        SET status = 'retrying', next_attempt_at = $2, last_error = $3
      WHERE id = $1 AND status = 'retrying'
      RETURNING ${PROJECTION}`,
    [id, nextAttemptAt.toISOString(), error],
  );
  return result.rows[0] ? freezeEvent(result.rows[0]) : null;
}

async function markFailed(
  pool: Pool,
  id: string,
  error: string,
): Promise<EcosystemEventRecord | null> {
  const result = await pool.query<EventRow>(
    `UPDATE ecosystem_events
        SET status = 'failed', next_attempt_at = NULL, last_error = $2
      WHERE id = $1 AND status = 'retrying'
      RETURNING ${PROJECTION}`,
    [id, error],
  );
  return result.rows[0] ? freezeEvent(result.rows[0]) : null;
}

function freezeEvent(row: EventRow): EcosystemEventRecord {
  return Object.freeze({
    id: row.id,
    tenantId: row.tenantId,
    eventType: row.eventType,
    eventId: row.eventId,
    payload: Object.freeze({ ...row.payload }),
    status: row.status,
    targetSystem: row.targetSystem,
    nextAttemptAt: row.nextAttemptAt,
    attemptCount: row.attemptCount,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
