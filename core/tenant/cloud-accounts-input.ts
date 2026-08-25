import { AppError } from "../shared/errors.js";
import {
  CLOUD_ACCOUNT_PROVIDERS,
  type CloudAccountCreateInput,
  type CloudAccountListInput,
  type CloudAccountPatchInput,
  type CloudAccountProvider,
} from "./cloud-accounts-types.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CURRENCY_PATTERN = /^[A-Z]{3}$/u;

export function parseCloudAccountId(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw invalid();
  return value;
}

export function parseCloudAccountListQuery(query: unknown): CloudAccountListInput {
  const object = closedRecord(query);
  const allowed = new Set(["limit", "cursor", "provider", "is_active"]);
  rejectUnknown(object, allowed);
  return Object.freeze({
    limit: parseLimit(object.limit),
    ...(object.provider === undefined ? {} : { provider: parseProvider(object.provider) }),
    ...(object.is_active === undefined ? {} : { isActive: parseBooleanText(object.is_active) }),
  });
}

export function normalizeCloudAccountCreate(body: unknown): CloudAccountCreateInput {
  const object = closedRecord(body);
  rejectUnknown(object, new Set(["provider", "external_ref", "display_name", "currency", "tags"]));
  if (
    object.provider === undefined ||
    object.external_ref === undefined ||
    object.display_name === undefined ||
    object.currency === undefined
  ) {
    throw invalid();
  }
  return Object.freeze({
    provider: parseProvider(object.provider),
    externalRef: canonicalExternalRef(object.external_ref),
    displayName: displayName(object.display_name),
    currency: currency(object.currency),
    tags: tags(object.tags ?? {}),
  });
}

export function normalizeCloudAccountPatch(body: unknown): CloudAccountPatchInput {
  const object = closedRecord(body);
  rejectUnknown(
    object,
    new Set(["expected_updated_at", "external_ref", "display_name", "currency", "tags"]),
  );
  if (typeof object.expected_updated_at !== "string" || object.expected_updated_at === "") {
    throw invalid();
  }
  const changes = {
    ...(object.external_ref === undefined
      ? {}
      : { externalRef: canonicalExternalRef(object.external_ref) }),
    ...(object.display_name === undefined ? {} : { displayName: displayName(object.display_name) }),
    ...(object.currency === undefined ? {} : { currency: currency(object.currency) }),
    ...(object.tags === undefined ? {} : { tags: tags(object.tags) }),
  };
  if (Object.keys(changes).length === 0) throw invalid();
  return Object.freeze({ expectedUpdatedAt: object.expected_updated_at, changes });
}

export function normalizeDeactivationReason(body: unknown): string {
  const object = closedRecord(body);
  rejectUnknown(object, new Set(["reason"]));
  const reason = cleanText(object.reason, 1, 512);
  return reason;
}

function parseLimit(value: unknown): number {
  if (value === undefined) return 50;
  if (typeof value !== "string" || !/^(?:[1-9]|[1-9][0-9]|100)$/u.test(value)) throw invalid();
  return Number.parseInt(value, 10);
}

function parseProvider(value: unknown): CloudAccountProvider {
  if (
    typeof value !== "string" ||
    !CLOUD_ACCOUNT_PROVIDERS.some((provider) => provider === value)
  ) {
    throw invalid();
  }
  return value as CloudAccountProvider;
}

function parseBooleanText(value: unknown): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw invalid();
}

function canonicalExternalRef(value: unknown): string {
  return cleanText(value, 1, 256).toLowerCase();
}

function displayName(value: unknown): string {
  return cleanText(value, 1, 200);
}

function currency(value: unknown): string {
  if (typeof value !== "string") throw invalid();
  const normalized = value.trim().toUpperCase();
  if (!CURRENCY_PATTERN.test(normalized)) throw invalid();
  return normalized;
}

function tags(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const encoded = JSON.stringify(value);
  if (!encoded || encoded.length > 8192 || /password|secret|token|credential/iu.test(encoded)) {
    throw invalid();
  }
  return Object.freeze({ ...(value as Record<string, unknown>) });
}

function cleanText(value: unknown, min: number, max: number): string {
  if (typeof value !== "string") throw invalid();
  const text = value.normalize("NFC").trim();
  if (text.length < min || text.length > max || hasControlCharacter(text)) {
    throw invalid();
  }
  return text;
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
    ) {
      return true;
    }
  }
  return false;
}

function closedRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}

function rejectUnknown(value: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw invalid();
}

function invalid(): AppError {
  return new AppError({
    code: "VALIDATION_ERROR",
    message: "Request is invalid.",
    statusCode: 400,
    details: [],
  });
}
