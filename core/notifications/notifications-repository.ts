import type { Pool, PoolClient, QueryResultRow } from "pg";

import { AppError } from "../shared/errors.js";
import type {
  NotificationEvent,
  NotificationCursorBoundary,
  NotificationListInput,
  NotificationPreferenceInput,
  NotificationPreferenceRecord,
  NotificationRecord,
} from "./notifications-types.js";

export interface NotificationRecipient {
  id: string;
  role: string;
}

export interface NotificationsRepository {
  list(
    tenantId: string,
    userId: string,
    input: Omit<NotificationListInput, "cursor"> & { cursor?: NotificationCursorBoundary },
  ): Promise<NotificationRecord[]>;
  unreadCount(tenantId: string, userId: string): Promise<number>;
  get(tenantId: string, userId: string, id: string): Promise<NotificationRecord | null>;
  markRead(tenantId: string, userId: string, id: string): Promise<NotificationRecord | null>;
  listPreferences(tenantId: string, userId: string): Promise<NotificationPreferenceRecord[]>;
  replacePreferences(
    tenantId: string,
    userId: string,
    actorRole: string,
    preferences: readonly NotificationPreferenceInput[],
  ): Promise<NotificationPreferenceRecord[]>;
  listRecipients(
    tenantId: string,
    userIds: readonly string[],
    roles: readonly string[],
  ): Promise<NotificationRecipient[]>;
  createForRecipient(
    tenantId: string,
    recipientUserId: string,
    event: NotificationEvent,
    templateId: string,
    title: string,
    body: string,
  ): Promise<NotificationRecord | null>;
}

interface NotificationRow extends QueryResultRow {
  id: string;
  tenantId: string;
  recipientUserId: string;
  eventType: string;
  sourceType: NotificationRecord["sourceType"];
  sourceId: string | null;
  templateId: string;
  urgency: NotificationRecord["urgency"];
  title: string;
  body: string;
  payload: Record<string, unknown>;
  status: NotificationRecord["status"];
  readAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PreferenceRow extends QueryResultRow {
  id: string;
  tenantId: string;
  userId: string;
  eventType: string;
  channel: NotificationPreferenceRecord["channel"];
  urgency: NotificationPreferenceRecord["urgency"];
  enabled: boolean;
  lockedByAdmin: boolean;
  createdAt: string;
  updatedAt: string;
}

const NOTIFICATION_PROJECTION = `id, tenant_id AS "tenantId", recipient_user_id AS "recipientUserId",
  event_type AS "eventType", source_type AS "sourceType", source_id AS "sourceId",
  template_id AS "templateId", urgency, title, body, payload, status,
  to_char(read_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "readAt",
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt",
  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt"`;

const PREFERENCE_PROJECTION = `id, tenant_id AS "tenantId", user_id AS "userId",
  event_type AS "eventType", channel, urgency, enabled, locked_by_admin AS "lockedByAdmin",
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt",
  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt"`;

export function createNotificationsRepository(pool: Pool): NotificationsRepository {
  return {
    list: (tenantId, userId, input) => list(pool, tenantId, userId, input),
    unreadCount: (tenantId, userId) => unreadCount(pool, tenantId, userId),
    get: (tenantId, userId, id) => get(pool, tenantId, userId, id),
    markRead: (tenantId, userId, id) => markRead(pool, tenantId, userId, id),
    listPreferences: (tenantId, userId) => listPreferences(pool, tenantId, userId),
    replacePreferences: (tenantId, userId, actorRole, preferences) =>
      replacePreferences(pool, tenantId, userId, actorRole, preferences),
    listRecipients: (tenantId, userIds, roles) => listRecipients(pool, tenantId, userIds, roles),
    createForRecipient: (tenantId, recipientUserId, event, templateId, title, body) =>
      createForRecipient(pool, tenantId, recipientUserId, event, templateId, title, body),
  };
}

async function list(
  pool: Pool,
  tenantId: string,
  userId: string,
  input: Omit<NotificationListInput, "cursor"> & { cursor?: NotificationCursorBoundary },
): Promise<NotificationRecord[]> {
  const result = await pool.query<NotificationRow>(
    `SELECT ${NOTIFICATION_PROJECTION}
       FROM notifications
      WHERE tenant_id = $1 AND recipient_user_id = $2
        AND ($3::text IS NULL OR status = $3)
        AND ($4::text IS NULL OR event_type = $4)
        AND ($5::timestamptz IS NULL OR (created_at, id) < ($5::timestamptz, $6::uuid))
      ORDER BY created_at DESC, id DESC
      LIMIT $7`,
    [
      tenantId,
      userId,
      input.status ?? null,
      input.eventType ?? null,
      input.cursor?.createdAt ?? null,
      input.cursor?.id ?? null,
      input.limit + 1,
    ],
  );
  return result.rows.map(freezeNotification);
}

async function unreadCount(pool: Pool, tenantId: string, userId: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM notifications
      WHERE tenant_id = $1 AND recipient_user_id = $2 AND status = 'unread'`,
    [tenantId, userId],
  );
  return Number.parseInt(result.rows[0]?.count ?? "0", 10);
}

async function get(
  pool: Pool,
  tenantId: string,
  userId: string,
  id: string,
): Promise<NotificationRecord | null> {
  const result = await pool.query<NotificationRow>(
    `SELECT ${NOTIFICATION_PROJECTION}
       FROM notifications
      WHERE tenant_id = $1 AND recipient_user_id = $2 AND id = $3`,
    [tenantId, userId, id],
  );
  return result.rows[0] ? freezeNotification(result.rows[0]) : null;
}

async function markRead(
  pool: Pool,
  tenantId: string,
  userId: string,
  id: string,
): Promise<NotificationRecord | null> {
  const result = await pool.query<NotificationRow>(
    `UPDATE notifications
        SET status = CASE WHEN status = 'unread' THEN 'read' ELSE status END,
            read_at = CASE WHEN status = 'unread' THEN clock_timestamp() ELSE read_at END
      WHERE tenant_id = $1 AND recipient_user_id = $2 AND id = $3
      RETURNING ${NOTIFICATION_PROJECTION}`,
    [tenantId, userId, id],
  );
  return result.rows[0] ? freezeNotification(result.rows[0]) : null;
}

async function listPreferences(
  pool: Pool,
  tenantId: string,
  userId: string,
): Promise<NotificationPreferenceRecord[]> {
  const result = await pool.query<PreferenceRow>(
    `SELECT ${PREFERENCE_PROJECTION}
       FROM notification_preferences
      WHERE tenant_id = $1 AND user_id = $2
      ORDER BY event_type ASC, channel ASC`,
    [tenantId, userId],
  );
  return result.rows.map(freezePreference);
}

async function replacePreferences(
  pool: Pool,
  tenantId: string,
  userId: string,
  actorRole: string,
  preferences: readonly NotificationPreferenceInput[],
): Promise<NotificationPreferenceRecord[]> {
  return withTenantTransaction(pool, tenantId, async (client) => {
    const current = await client.query<PreferenceRow>(
      `SELECT ${PREFERENCE_PROJECTION}
         FROM notification_preferences
        WHERE tenant_id = $1 AND user_id = $2
        FOR UPDATE`,
      [tenantId, userId],
    );
    const currentByKey = new Map(
      current.rows.map((row) => [`${row.eventType}\0${row.channel}`, row]),
    );
    for (const input of preferences) {
      const key = `${input.eventType}\0${input.channel}`;
      const previous = currentByKey.get(key);
      const locked = input.lockedByAdmin ?? previous?.lockedByAdmin ?? false;
      if (
        actorRole !== "tenant_admin" &&
        (input.lockedByAdmin !== undefined || previous?.lockedByAdmin)
      ) {
        if (input.lockedByAdmin !== undefined || input.enabled === false) {
          throw preferenceConflict();
        }
      }
      if (input.urgency === "high" && input.enabled === false && !locked) {
        throw preferenceConflict();
      }
      await client.query(
        `INSERT INTO notification_preferences
           (tenant_id, user_id, event_type, channel, urgency, enabled, locked_by_admin)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (tenant_id, user_id, event_type, channel)
         DO UPDATE SET urgency = EXCLUDED.urgency,
                       enabled = EXCLUDED.enabled,
                       locked_by_admin = EXCLUDED.locked_by_admin
         WHERE notification_preferences.locked_by_admin = false OR $8 = 'tenant_admin'`,
        [
          tenantId,
          userId,
          input.eventType,
          input.channel,
          input.urgency,
          input.enabled,
          locked,
          actorRole,
        ],
      );
    }
    const result = await client.query<PreferenceRow>(
      `SELECT ${PREFERENCE_PROJECTION}
         FROM notification_preferences
        WHERE tenant_id = $1 AND user_id = $2
        ORDER BY event_type ASC, channel ASC`,
      [tenantId, userId],
    );
    return result.rows.map(freezePreference);
  });
}

async function listRecipients(
  pool: Pool,
  tenantId: string,
  userIds: readonly string[],
  roles: readonly string[],
): Promise<NotificationRecipient[]> {
  const result = await pool.query<NotificationRecipient>(
    `SELECT id, role
       FROM users
      WHERE tenant_id = $1 AND is_active = true
        AND (
          (cardinality($2::uuid[]) > 0 AND id = ANY($2::uuid[]))
          OR (cardinality($3::text[]) > 0 AND role = ANY($3::text[]))
        )
      ORDER BY id`,
    [tenantId, userIds, roles],
  );
  return result.rows.map((row) => Object.freeze({ id: row.id, role: row.role }));
}

function preferenceConflict(): AppError {
  return new AppError({
    code: "NOTIFICATION_PREFERENCE_LOCKED",
    message: "This notification preference requires tenant-admin control.",
    statusCode: 409,
  });
}

async function createForRecipient(
  pool: Pool,
  tenantId: string,
  recipientUserId: string,
  event: NotificationEvent,
  templateId: string,
  title: string,
  body: string,
): Promise<NotificationRecord | null> {
  const result = await pool.query<NotificationRow>(
    `INSERT INTO notifications
       (tenant_id, recipient_user_id, event_type, source_type, source_id, template_id,
        urgency, title, body, payload)
     SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb
      WHERE NOT EXISTS (
        SELECT 1 FROM notifications
         WHERE tenant_id = $1 AND recipient_user_id = $2
           AND event_type = $3 AND source_type = $4
           AND source_id IS NOT DISTINCT FROM $5::uuid
           AND template_id = $6
      )
     RETURNING ${NOTIFICATION_PROJECTION}`,
    [
      tenantId,
      recipientUserId,
      event.eventType,
      event.sourceType,
      event.sourceId,
      templateId,
      event.urgency,
      title,
      body,
      JSON.stringify({ ...event.payload, event_id: event.eventId }),
    ],
  );
  return result.rows[0] ? freezeNotification(result.rows[0]) : null;
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

function freezeNotification(row: NotificationRow): NotificationRecord {
  return Object.freeze({
    id: row.id,
    tenantId: row.tenantId,
    recipientUserId: row.recipientUserId,
    eventType: row.eventType,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    templateId: row.templateId,
    urgency: row.urgency,
    title: row.title,
    body: row.body,
    payload: Object.freeze({ ...row.payload }),
    status: row.status,
    readAt: row.readAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function freezePreference(row: PreferenceRow): NotificationPreferenceRecord {
  return Object.freeze({
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    eventType: row.eventType,
    channel: row.channel,
    urgency: row.urgency,
    enabled: row.enabled,
    lockedByAdmin: row.lockedByAdmin,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
