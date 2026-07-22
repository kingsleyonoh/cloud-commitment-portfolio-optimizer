import { AppError } from "../shared/errors.js";
import { isUserRole } from "./request-context.js";
import type {
  UserCreateInput,
  UserListQuery,
  UserPatchChanges,
  UserPatchInput,
} from "./users-types.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u;
const CREATE_KEYS = ["email", "name", "role", "is_active"] as const;
const PATCH_KEYS = ["expected_updated_at", "email", "name", "role", "is_active"] as const;

export function normalizeUserCreate(input: unknown): UserCreateInput {
  const value = closedRecord(input, CREATE_KEYS);
  if (typeof value.email !== "string" || typeof value.name !== "string") throw invalid();
  if (!isUserRole(value.role)) throw invalid();
  if (value.is_active !== undefined && typeof value.is_active !== "boolean") throw invalid();
  return {
    email: normalizeUserEmail(value.email),
    name: normalizeUserName(value.name),
    role: value.role,
    isActive: value.is_active ?? true,
  };
}

export function normalizeUserPatch(input: unknown): UserPatchInput {
  const value = closedRecord(input, PATCH_KEYS);
  const expectedUpdatedAt = parseUserTimestamp(value.expected_updated_at);
  const changes: UserPatchChanges = {};
  const changedFields: UserPatchInput["changedFields"] = [];
  if (value.email !== undefined) {
    if (typeof value.email !== "string") throw invalid();
    changes.email = normalizeUserEmail(value.email);
    changedFields.push("email");
  }
  if (value.name !== undefined) {
    if (typeof value.name !== "string") throw invalid();
    changes.name = normalizeUserName(value.name);
    changedFields.push("name");
  }
  if (value.role !== undefined) {
    if (!isUserRole(value.role)) throw invalid();
    changes.role = value.role;
    changedFields.push("role");
  }
  if (value.is_active !== undefined) {
    if (typeof value.is_active !== "boolean") throw invalid();
    changes.isActive = value.is_active;
    changedFields.push("is_active");
  }
  if (changedFields.length === 0) throw invalid();
  return { expectedUpdatedAt, changes, changedFields };
}

export function parseUserListQuery(input: unknown): UserListQuery {
  const value = closedRecord(input, ["limit", "cursor"] as const);
  let limit = 25;
  if (value.limit !== undefined) {
    if (typeof value.limit !== "string" || !/^(?:[1-9]|[1-9][0-9]|100)$/u.test(value.limit)) {
      throw invalid();
    }
    limit = Number.parseInt(value.limit, 10);
  }
  if (value.cursor !== undefined) {
    if (
      typeof value.cursor !== "string" ||
      value.cursor.length === 0 ||
      value.cursor.length > 512
    ) {
      throw invalid();
    }
    return { limit, cursor: value.cursor };
  }
  return { limit };
}

export function parseUserId(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw invalid();
  return value;
}

export function parseUserTimestamp(value: unknown): string {
  if (typeof value !== "string" || !TIMESTAMP_PATTERN.test(value)) throw invalid();
  const wholeSeconds = `${value.slice(0, 19)}Z`;
  const parsed = new Date(wholeSeconds);
  if (
    !Number.isFinite(parsed.valueOf()) ||
    parsed.toISOString().slice(0, 19) !== value.slice(0, 19)
  ) {
    throw invalid();
  }
  return value;
}

export function normalizeUserEmail(value: string): string {
  const normalized = value.normalize("NFC").trim().toLowerCase();
  if (
    normalized.length === 0 ||
    [...normalized].length > 254 ||
    hasControlCharacters(normalized) ||
    /\s/u.test(normalized)
  ) {
    throw invalid();
  }
  const parts = normalized.split("@");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw invalid();
  return normalized;
}

export function normalizeUserName(value: string): string {
  const normalized = value.normalize("NFC").trim();
  if (normalized.length === 0 || [...normalized].length > 200 || hasControlCharacters(normalized)) {
    throw invalid();
  }
  return normalized;
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || (code >= 127 && code <= 159);
  });
}

function closedRecord<const T extends readonly string[]>(
  input: unknown,
  allowed: T,
): Record<T[number], unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw invalid();
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw invalid();
  return value;
}

function invalid(): AppError {
  return new AppError({
    code: "VALIDATION_ERROR",
    message: "Request is invalid.",
    statusCode: 400,
    details: [],
  });
}
