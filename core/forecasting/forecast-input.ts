import { AppError } from "../shared/errors.js";
import type {
  ForecastMethod,
  ForecastModelCreateInput,
  ForecastModelListInput,
  ForecastModelStatus,
  ForecastRunCreateInput,
  ForecastRunListInput,
  ForecastRunStatus,
} from "./forecast-types.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DATE_PATTERN = /^[0-9]{4}-(?:0[1-9]|1[0-2])-[0-3][0-9]$/u;
const SIGNED_BIGINT_PATTERN = /^-?(?:0|[1-9][0-9]{0,18})$/u;

export function parseForecastModelCreateBody(body: unknown): ForecastModelCreateInput {
  const object = closedRecord(body);
  rejectUnknown(
    object,
    new Set(["name", "provider_scope", "service_scope", "horizon_months", "method", "config"]),
  );
  const method = parseMethod(object.method);
  return Object.freeze({
    name: cleanText(object.name, 1, 200),
    providerScope: providerScope(object.provider_scope),
    serviceScope: serviceScope(object.service_scope),
    horizonMonths: horizon(object.horizon_months),
    method,
    config: configObject(object.config),
  });
}

export function parseForecastRunCreateBody(
  body: unknown,
  defaultSeed: bigint,
): ForecastRunCreateInput {
  const object = closedRecord(body);
  rejectUnknown(
    object,
    new Set([
      "forecast_model_id",
      "input_window_start",
      "input_window_end",
      "horizon_months",
      "random_seed",
    ]),
  );
  const inputWindowStart = dateValue(object.input_window_start);
  const inputWindowEnd = dateValue(object.input_window_end);
  if (inputWindowEnd < inputWindowStart) throw invalid();
  return Object.freeze({
    forecastModelId: uuidValue(object.forecast_model_id),
    inputWindowStart,
    inputWindowEnd,
    horizonMonths: horizon(object.horizon_months),
    randomSeed:
      object.random_seed === undefined ? defaultSeed.toString() : signedBigint(object.random_seed),
  });
}

export function parseForecastModelListQuery(query: unknown): ForecastModelListInput {
  const object = closedRecord(query);
  rejectUnknown(object, new Set(["limit", "cursor", "status", "method"]));
  return Object.freeze({
    limit: parseLimit(object.limit),
    ...(object.status === undefined ? {} : { status: parseModelStatus(object.status) }),
    ...(object.method === undefined ? {} : { method: parseMethod(object.method) }),
  });
}

export function parseForecastRunListQuery(query: unknown): ForecastRunListInput {
  const object = closedRecord(query);
  rejectUnknown(object, new Set(["limit", "cursor", "status", "forecast_model_id"]));
  return Object.freeze({
    limit: parseLimit(object.limit),
    ...(object.status === undefined ? {} : { status: parseRunStatus(object.status) }),
    ...(object.forecast_model_id === undefined
      ? {}
      : { forecastModelId: uuidValue(object.forecast_model_id) }),
  });
}

export function parseForecastId(value: unknown): string {
  return uuidValue(value);
}

function providerScope(value: unknown): readonly ["aws"] {
  if (!Array.isArray(value) || value.length !== 1 || value[0] !== "aws") throw invalid();
  return Object.freeze(["aws"]);
}

function serviceScope(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw invalid();
  const values = value.map((entry) => cleanText(entry, 1, 128));
  if (new Set(values).size !== values.length) throw invalid();
  return Object.freeze(values);
}

function parseMethod(value: unknown): ForecastMethod {
  if (value !== "seasonal_naive") throw invalid();
  return value;
}

function parseModelStatus(value: unknown): ForecastModelStatus {
  if (value !== "draft" && value !== "active" && value !== "archived") throw invalid();
  return value;
}

function parseRunStatus(value: unknown): ForecastRunStatus {
  if (
    value !== "queued" &&
    value !== "running" &&
    value !== "completed" &&
    value !== "failed" &&
    value !== "cancelled"
  ) {
    throw invalid();
  }
  return value;
}

function horizon(value: unknown): number {
  if (![1, 3, 6, 12, 24, 36].includes(value as number)) throw invalid();
  return value as number;
}

function parseLimit(value: unknown): number {
  if (value === undefined) return 50;
  if (typeof value !== "string" || !/^(?:[1-9]|[1-9][0-9]|100)$/u.test(value)) throw invalid();
  return Number.parseInt(value, 10);
}

function uuidValue(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw invalid();
  return value;
}

function signedBigint(value: unknown): string {
  if (typeof value !== "string" || !SIGNED_BIGINT_PATTERN.test(value)) throw invalid();
  const parsed = BigInt(value);
  if (parsed < -9223372036854775808n || parsed > 9223372036854775807n) throw invalid();
  return parsed.toString();
}

function dateValue(value: unknown): string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) throw invalid();
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw invalid();
  }
  return value;
}

function configObject(value: unknown): Record<string, unknown> {
  const object = closedRecord(value);
  const encoded = JSON.stringify(object);
  if (
    encoded.length > 65_536 ||
    /credentials?|password|secret|token|raw_(?:file|bytes|row|rows)/iu.test(encoded)
  ) {
    throw invalid();
  }
  return Object.freeze({ ...object });
}

function cleanText(value: unknown, min: number, max: number): string {
  if (typeof value !== "string") throw invalid();
  const text = value.normalize("NFC").trim();
  if (text.length < min || text.length > max || hasControlCharacter(text)) throw invalid();
  return text;
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
