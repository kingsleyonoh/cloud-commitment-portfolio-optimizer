import { AppError } from "../shared/errors.js";
import type { ImportControlTotal, ImportCreateInput } from "./imports-types.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const OBJECT_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,2047}$/u;
const MONTH_PATTERN = /^[0-9]{4}-(?:0[1-9]|1[0-2])$/u;
const DECIMAL_8_PATTERN = /^(?:0|[1-9][0-9]{0,19})\.[0-9]{8}$/u;
const UNSIGNED_INTEGER_PATTERN = /^(?:0|[1-9][0-9]{0,18})$/u;

export function parseImportCreateBody(body: unknown): ImportCreateInput {
  const object = closedRecord(body);
  rejectUnknown(
    object,
    new Set(["source", "format", "object_uri", "cloud_account_id", "control_totals"]),
  );
  if (
    object.source !== "synthetic" ||
    object.format !== "csv" ||
    typeof object.object_uri !== "string" ||
    typeof object.cloud_account_id !== "string" ||
    !Array.isArray(object.control_totals)
  ) {
    throw invalid();
  }
  return Object.freeze({
    source: "synthetic",
    format: "csv",
    objectUri: objectKey(object.object_uri),
    cloudAccountId: uuid(object.cloud_account_id),
    controlTotals: Object.freeze(object.control_totals.map(controlTotal)),
  });
}

function controlTotal(value: unknown): ImportControlTotal {
  const object = closedRecord(value);
  rejectUnknown(
    object,
    new Set([
      "provider",
      "service_code",
      "region",
      "month",
      "line_count",
      "usage_quantity",
      "on_demand_cost_cents",
      "realized_cost_cents",
      "commitment_applied_cents",
    ]),
  );
  if (
    (object.provider !== "aws" && object.provider !== "azure" && object.provider !== "gcp") ||
    typeof object.month !== "string" ||
    !MONTH_PATTERN.test(object.month)
  ) {
    throw invalid();
  }
  return Object.freeze({
    provider: object.provider,
    serviceCode: cleanText(object.service_code, 1, 200),
    region: cleanText(object.region, 1, 100),
    month: object.month,
    lineCount: unsignedInteger(object.line_count),
    usageQuantity: decimal8(object.usage_quantity),
    onDemandCostCents: unsignedInteger(object.on_demand_cost_cents),
    realizedCostCents: unsignedInteger(object.realized_cost_cents),
    commitmentAppliedCents: unsignedInteger(object.commitment_applied_cents),
  });
}

function objectKey(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed !== value ||
    !OBJECT_KEY_PATTERN.test(trimmed) ||
    trimmed.includes("..") ||
    trimmed.includes("//") ||
    trimmed.includes("\\")
  ) {
    throw invalid();
  }
  return trimmed;
}

function uuid(value: string): string {
  if (!UUID_PATTERN.test(value)) throw invalid();
  return value;
}

function cleanText(value: unknown, min: number, max: number): string {
  if (typeof value !== "string") throw invalid();
  const text = value.normalize("NFC").trim();
  if (text.length < min || text.length > max || hasControlCharacter(text)) throw invalid();
  return text;
}

function decimal8(value: unknown): string {
  if (typeof value !== "string" || !DECIMAL_8_PATTERN.test(value)) throw invalid();
  return value;
}

function unsignedInteger(value: unknown): string {
  if (typeof value !== "string" || !UNSIGNED_INTEGER_PATTERN.test(value)) throw invalid();
  return value;
}

function closedRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}

function rejectUnknown(value: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw invalid();
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

function invalid(): AppError {
  return new AppError({
    code: "VALIDATION_ERROR",
    message: "Request is invalid.",
    statusCode: 400,
    details: [],
  });
}
