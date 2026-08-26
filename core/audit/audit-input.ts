import { AppError } from "../shared/errors.js";
import { decodeAuditCursor } from "./audit-cursor.js";
import type { AuditActorType, AuditListInput } from "./audit-types.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ACTOR_TYPES: readonly AuditActorType[] = ["user", "api_key", "job", "system"];

export function parseAuditListQuery(value: unknown): AuditListInput {
  const object = record(value);
  const allowed = new Set(["limit", "cursor", "action", "actor_type", "entity_type", "entity_id"]);
  if (Object.keys(object).some((key) => !allowed.has(key))) throw invalid();
  const cursor = object.cursor === undefined ? undefined : cursorValue(object.cursor);
  const action = optionalText(object.action, 200);
  const actorType = optionalOneOf(object.actor_type, ACTOR_TYPES);
  const entityType = optionalText(object.entity_type, 200);
  const entityId = object.entity_id === undefined ? undefined : uuid(object.entity_id);
  return {
    limit: parseLimit(object.limit),
    ...(cursor === undefined ? {} : { cursor }),
    ...(action === undefined ? {} : { action }),
    ...(actorType === undefined ? {} : { actorType }),
    ...(entityType === undefined ? {} : { entityType }),
    ...(entityId === undefined ? {} : { entityId }),
  };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}

function parseLimit(value: unknown): number {
  if (value === undefined) return 50;
  if (typeof value !== "string" || !/^(?:[1-9]|[1-9][0-9]|100)$/u.test(value)) throw invalid();
  return Number(value);
}

function cursorValue(value: unknown): { createdAt: string; id: string } {
  if (typeof value !== "string" || value.length > 512 || value.length === 0) throw invalid();
  return decodeAuditCursor(value);
}

function optionalText(value: unknown, max: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw invalid();
  const result = value.normalize("NFC").trim();
  if (!result || [...result].length > max || hasControlCharacters(result)) throw invalid();
  return result;
}

function optionalOneOf<T extends string>(value: unknown, values: readonly T[]): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !values.includes(value as T)) throw invalid();
  return value as T;
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw invalid();
  return value;
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || (code >= 127 && code <= 159);
  });
}

function invalid(): AppError {
  return new AppError({
    code: "VALIDATION_ERROR",
    message: "Request is invalid.",
    statusCode: 400,
  });
}
