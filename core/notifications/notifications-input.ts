import { AppError } from "../shared/errors.js";
import { isUserRole } from "../tenant/request-context.js";
import type {
  NotificationChannel,
  NotificationListInput,
  NotificationPreferenceInput,
  NotificationStatus,
  NotificationUrgency,
} from "./notifications-types.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const STATUS: readonly NotificationStatus[] = ["unread", "read", "archived", "dismissed"];
const CHANNELS: readonly NotificationChannel[] = ["in_app", "email"];
const URGENCIES: readonly NotificationUrgency[] = ["low", "medium", "high"];

export function parseNotificationId(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw invalid();
  return value;
}

export function parseNotificationListQuery(value: unknown): NotificationListInput {
  const input = record(value);
  const limit = parseLimit(input.limit);
  const cursor =
    input.cursor === undefined
      ? undefined
      : typeof input.cursor === "string" && input.cursor.length <= 512 && input.cursor.length > 0
        ? input.cursor
        : null;
  if (cursor === null) throw invalid();
  if (input.status !== undefined && !isOneOf(input.status, STATUS)) throw invalid();
  if (input.event_type !== undefined && !safeText(input.event_type, 200)) throw invalid();
  return {
    limit,
    ...(cursor === undefined ? {} : { cursor }),
    ...(input.status === undefined ? {} : { status: input.status as NotificationStatus }),
    ...(input.event_type === undefined ? {} : { eventType: input.event_type as string }),
  };
}

export function parseNotificationPreferences(value: unknown): NotificationPreferenceInput[] {
  const input = record(value, ["preferences"]);
  if (!Array.isArray(input.preferences) || input.preferences.length > 100) throw invalid();
  const seen = new Set<string>();
  return input.preferences.map((entry) => {
    const row = record(entry, ["event_type", "channel", "urgency", "enabled", "locked_by_admin"]);
    if (
      !safeText(row.event_type, 200) ||
      !isOneOf(row.channel, CHANNELS) ||
      !isOneOf(row.urgency, URGENCIES) ||
      typeof row.enabled !== "boolean"
    ) {
      throw invalid();
    }
    if (row.locked_by_admin !== undefined && typeof row.locked_by_admin !== "boolean") {
      throw invalid();
    }
    const eventType = row.event_type as string;
    const channel = row.channel as NotificationChannel;
    const key = `${eventType}\0${channel}`;
    if (seen.has(key)) throw invalid();
    seen.add(key);
    return {
      eventType,
      channel,
      urgency: row.urgency as NotificationUrgency,
      enabled: row.enabled,
      ...(row.locked_by_admin === undefined
        ? {}
        : { lockedByAdmin: row.locked_by_admin as boolean }),
    };
  });
}

export function parseNotificationEventRecipients(value: unknown): {
  userIds: string[];
  roles: string[];
} {
  const input = record(value, ["user_ids", "roles"]);
  const userIds = input.user_ids === undefined ? [] : parseUuidArray(input.user_ids);
  const roles = input.roles === undefined ? [] : parseStringArray(input.roles);
  if (roles.some((role) => !isUserRole(role))) throw invalid();
  return { userIds, roles };
}

function record(value: unknown, allowed?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const result = value as Record<string, unknown>;
  if (allowed && Object.keys(result).some((key) => !allowed.includes(key))) throw invalid();
  return result;
}

function parseLimit(value: unknown): number {
  if (value === undefined) return 25;
  if (typeof value !== "string" || !/^(?:[1-9]|[1-9][0-9]|100)$/u.test(value)) throw invalid();
  return Number(value);
}

function parseUuidArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100) throw invalid();
  const result = value.map((item) => {
    if (typeof item !== "string" || !UUID_PATTERN.test(item)) throw invalid();
    return item;
  });
  return [...new Set(result)];
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 16) throw invalid();
  return [
    ...new Set(
      value.map((item) => {
        if (!safeText(item, 200)) throw invalid();
        return item as string;
      }),
    ),
  ];
}

function safeText(value: unknown, max: number): value is string {
  if (typeof value !== "string") return false;
  const normalized = value.normalize("NFC").trim();
  return (
    normalized.length > 0 && [...normalized].length <= max && !hasControlCharacters(normalized)
  );
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || (code >= 127 && code <= 159);
  });
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && allowed.includes(value as T);
}

function invalid(): AppError {
  return new AppError({
    code: "VALIDATION_ERROR",
    message: "Request is invalid.",
    statusCode: 400,
  });
}
