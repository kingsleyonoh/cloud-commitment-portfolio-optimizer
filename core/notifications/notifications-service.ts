import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { AppError } from "../shared/errors.js";
import type { RequestContext, UserRequestContext } from "../tenant/request-context.js";
import { decodeNotificationCursor, encodeNotificationCursor } from "./notifications-cursor.js";
import {
  parseNotificationId,
  parseNotificationListQuery,
  parseNotificationPreferences,
} from "./notifications-input.js";
import type { NotificationsRepository } from "./notifications-repository.js";
import type {
  Notification,
  NotificationEvent,
  NotificationListPage,
  NotificationPreference,
  NotificationPreferenceRecord,
  NotificationRecord,
} from "./notifications-types.js";

export interface NotificationsService {
  list(context: RequestContext, query: unknown): Promise<NotificationListPage>;
  markRead(context: RequestContext, id: unknown): Promise<Notification>;
  listPreferences(
    context: RequestContext,
  ): Promise<{ preferences: readonly NotificationPreference[] }>;
  updatePreferences(
    context: RequestContext,
    body: unknown,
  ): Promise<{ preferences: readonly NotificationPreference[] }>;
  emit(event: NotificationEvent): Promise<readonly NotificationRecord[]>;
}

export interface NotificationsServiceOptions {
  resolveTemplate?: (templateId: string, tenantId: string) => Promise<string>;
  defaultRecipientRoles?: readonly string[];
}

const DEFAULT_RECIPIENT_ROLES = [
  "tenant_admin",
  "finops_analyst",
  "finance_approver",
  "read_only_auditor",
] as const;

export function createNotificationsService(
  repository: NotificationsRepository,
  options: NotificationsServiceOptions = {},
): NotificationsService {
  const resolveTemplate = options.resolveTemplate ?? resolveNotificationTemplate;
  const defaultRecipientRoles = options.defaultRecipientRoles ?? DEFAULT_RECIPIENT_ROLES;
  return {
    list: (context, query) => listNotifications(repository, context, query),
    markRead: (context, id) => markNotificationRead(repository, context, id),
    listPreferences: (context) => listNotificationPreferences(repository, context),
    updatePreferences: (context, body) => updateNotificationPreferences(repository, context, body),
    emit: (event) => emitNotification(repository, resolveTemplate, defaultRecipientRoles, event),
  };
}

async function listNotifications(
  repository: NotificationsRepository,
  context: RequestContext,
  query: unknown,
): Promise<NotificationListPage> {
  const user = requireUser(context);
  const parsed = parseNotificationListQuery(query);
  const cursor = parsed.cursor ? decodeNotificationCursor(parsed.cursor) : undefined;
  const [rows, unreadCount] = await Promise.all([
    safe(() =>
      repository.list(user.tenantId, user.actorUserId, {
        limit: parsed.limit,
        ...(parsed.status === undefined ? {} : { status: parsed.status }),
        ...(parsed.eventType === undefined ? {} : { eventType: parsed.eventType }),
        ...(cursor === undefined ? {} : { cursor }),
      }),
    ),
    safe(() => repository.unreadCount(user.tenantId, user.actorUserId)),
  ]);
  const page = rows.slice(0, parsed.limit);
  const last = page.at(-1);
  return {
    notifications: page.map(toNotification),
    next_cursor:
      rows.length > parsed.limit && last
        ? encodeNotificationCursor({ createdAt: last.createdAt, id: last.id })
        : null,
    unread_count: unreadCount,
  };
}

async function markNotificationRead(
  repository: NotificationsRepository,
  context: RequestContext,
  idValue: unknown,
): Promise<Notification> {
  const user = requireUser(context);
  const id = parseNotificationId(idValue);
  const row = await safe(() => repository.markRead(user.tenantId, user.actorUserId, id));
  if (!row) throw notFound();
  return toNotification(row);
}

async function listNotificationPreferences(
  repository: NotificationsRepository,
  context: RequestContext,
): Promise<{ preferences: readonly NotificationPreference[] }> {
  const user = requireUser(context);
  const rows = await safe(() => repository.listPreferences(user.tenantId, user.actorUserId));
  return { preferences: rows.map(toPreference) };
}

async function updateNotificationPreferences(
  repository: NotificationsRepository,
  context: RequestContext,
  body: unknown,
): Promise<{ preferences: readonly NotificationPreference[] }> {
  const user = requireUser(context);
  const preferences = parseNotificationPreferences(body);
  const rows = await safe(() =>
    repository.replacePreferences(user.tenantId, user.actorUserId, user.role, preferences),
  );
  return { preferences: rows.map(toPreference) };
}

async function emitNotification(
  repository: NotificationsRepository,
  resolveTemplate: (templateId: string, tenantId: string) => Promise<string>,
  defaultRecipientRoles: readonly string[],
  event: NotificationEvent,
): Promise<readonly NotificationRecord[]> {
  const templateId = notificationTemplateId(event.templateName);
  const template = await safeTemplate(() => resolveTemplate(templateId, event.tenantId));
  const recipients = await safe(() =>
    repository.listRecipients(
      event.tenantId,
      event.recipientUserIds ?? [],
      event.recipientRoles ?? (event.recipientUserIds ? [] : defaultRecipientRoles),
    ),
  );
  const created: NotificationRecord[] = [];
  for (const recipient of recipients) {
    const preferences = await safe(() => repository.listPreferences(event.tenantId, recipient.id));
    if (!notificationEnabled(preferences, event)) continue;
    const rendered = renderNotificationTemplate(template, event);
    const row = await safe(() =>
      repository.createForRecipient(
        event.tenantId,
        recipient.id,
        event,
        templateId,
        rendered.title,
        rendered.body,
      ),
    );
    if (row) created.push(row);
  }
  return Object.freeze(created);
}

export function notificationTemplateId(templateName: string): string {
  const normalized = templateName.normalize("NFC").trim();
  if (!/^[a-z][a-z0-9_-]{0,80}$/u.test(normalized)) throw templateMissing();
  return `notification:${normalized}:v1`;
}

export async function resolveNotificationTemplate(
  templateId: string,
  _tenantId: string,
): Promise<string> {
  if (!/^notification:[a-z][a-z0-9_-]{0,80}:v1$/u.test(templateId)) throw templateMissing();
  const fileName = `${templateId.replaceAll(":", "_")}.hbs`;
  try {
    return await readFile(
      fileURLToPath(new URL(`./templates/${fileName}`, import.meta.url)),
      "utf8",
    );
  } catch {
    throw templateMissing();
  }
}

export function renderNotificationTemplate(
  template: string,
  event: NotificationEvent,
): { title: string; body: string } {
  const parts = template.split("\n---\n");
  if (parts.length !== 2) throw renderFailed();
  const [titleTemplate, bodyTemplate] = parts;
  return {
    title: renderTemplatePart(titleTemplate!, event),
    body: renderTemplatePart(bodyTemplate!, event),
  };
}

function renderTemplatePart(template: string, event: NotificationEvent): string {
  const rendered = template.replace(
    /\{\{\s*([a-z][a-z0-9_.-]{0,80})\s*\}\}/gu,
    (_match, key: string) => {
      const value = templateValue(key, event);
      if (value === undefined) throw renderFailed();
      return String(value);
    },
  );
  if (/\{\{/u.test(rendered)) throw renderFailed();
  const normalized = rendered.normalize("NFC").trim();
  if (
    !normalized ||
    normalized.length > 10000 ||
    hasControlCharacters(normalized)
  ) {
    throw renderFailed();
  }
  return normalized;
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || (code >= 127 && code <= 159);
  });
}

function templateValue(
  key: string,
  event: NotificationEvent,
): string | number | boolean | undefined {
  if (key === "event_type") return event.eventType;
  if (key === "event_id") return event.eventId;
  if (key === "source_type") return event.sourceType;
  if (key === "source_id") return event.sourceId ?? undefined;
  if (key === "urgency") return event.urgency;
  if (key.startsWith("payload.")) {
    const value = event.payload[key.slice("payload.".length)];
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
      ? value
      : undefined;
  }
  return undefined;
}

function notificationEnabled(
  preferences: readonly NotificationPreferenceRecord[],
  event: NotificationEvent,
): boolean {
  const preference = preferences.find(
    (row) => row.eventType === event.eventType && row.channel === "in_app",
  );
  if (!preference || preference.enabled) return true;
  if (event.urgency === "high") return !preference.lockedByAdmin;
  return false;
}

function toNotification(row: NotificationRecord): Notification {
  return {
    id: row.id,
    event_type: row.eventType,
    source_type: row.sourceType,
    source_id: row.sourceId,
    template_id: row.templateId,
    urgency: row.urgency,
    title: row.title,
    body: row.body,
    payload: row.payload,
    status: row.status,
    read_at: row.readAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function toPreference(row: NotificationPreferenceRecord): NotificationPreference {
  return {
    id: row.id,
    event_type: row.eventType,
    channel: row.channel,
    urgency: row.urgency,
    enabled: row.enabled,
    locked_by_admin: row.lockedByAdmin,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function requireUser(context: RequestContext): UserRequestContext {
  if (context.actorType !== "user")
    throw new AppError({ code: "FORBIDDEN", message: "Access denied.", statusCode: 403 });
  return context;
}

async function safe<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError({
      code: "NOTIFICATIONS_UNAVAILABLE",
      message: "Notifications are temporarily unavailable.",
      statusCode: 503,
    });
  }
}

async function safeTemplate(operation: () => Promise<string>): Promise<string> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw templateMissing();
  }
}

function notFound(): AppError {
  return new AppError({
    code: "NOT_FOUND",
    message: "The requested resource was not found.",
    statusCode: 404,
  });
}

function templateMissing(): AppError {
  return new AppError({
    code: "NOTIFICATION_TEMPLATE_NOT_FOUND",
    message: "The notification template is unavailable.",
    statusCode: 503,
  });
}

function renderFailed(): AppError {
  return new AppError({
    code: "NOTIFICATION_RENDER_FAILED",
    message: "The notification could not be rendered.",
    statusCode: 503,
  });
}
