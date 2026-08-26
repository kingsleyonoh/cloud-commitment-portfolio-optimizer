import { AppError } from "../shared/errors.js";
import type {
  BacktestBaseline,
  BacktestCreateInput,
  BacktestListInput,
  BacktestRunStatus,
} from "./backtests-types.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const NAME_MAX_LENGTH = 200;
const DEFAULT_BASELINE: BacktestBaseline = "seventy_percent_utilization";

export function parseBacktestCreateBody(body: unknown, maxMonths: number): BacktestCreateInput {
  const object = closedRecord(body);
  rejectUnknown(object, new Set(["name", "policy_id", "baseline", "window_start", "window_end"]));
  if (
    object.policy_id === undefined ||
    object.window_start === undefined ||
    object.window_end === undefined
  ) {
    throw invalid();
  }
  const windowStart = dateValue(object.window_start);
  const windowEnd = dateValue(object.window_end);
  assertWindow(windowStart, windowEnd, maxMonths);
  return Object.freeze({
    name: object.name === undefined ? defaultName(windowStart, windowEnd) : nameValue(object.name),
    policyId: uuidValue(object.policy_id),
    baseline: object.baseline === undefined ? DEFAULT_BASELINE : baselineValue(object.baseline),
    windowStart,
    windowEnd,
  });
}

export function parseBacktestListQuery(query: unknown): BacktestListInput {
  if (!query || typeof query !== "object" || Array.isArray(query)) return { limit: 50 };
  const input = query as Record<string, unknown>;
  rejectUnknown(input, new Set(["limit", "status", "baseline", "policy_id"]));
  const limitValue = input.limit;
  const limit =
    limitValue === undefined
      ? 50
      : typeof limitValue === "string" && /^(?:[1-9]|[1-9][0-9]|100)$/u.test(limitValue)
        ? Number(limitValue)
        : null;
  if (limit === null) throw invalid();
  return Object.freeze({
    limit,
    ...(input.status === undefined ? {} : { status: statusValue(input.status) }),
    ...(input.baseline === undefined ? {} : { baseline: baselineValue(input.baseline) }),
    ...(input.policy_id === undefined ? {} : { policyId: uuidValue(input.policy_id) }),
  });
}

export function parseBacktestId(value: unknown): string {
  return uuidValue(value);
}

function defaultName(windowStart: string, windowEnd: string): string {
  return `Backtest ${windowStart} through ${windowEnd}`;
}

function nameValue(value: unknown): string {
  if (typeof value !== "string") throw invalid();
  const name = value.trim();
  if (name.length === 0 || name.length > NAME_MAX_LENGTH || /[\p{C}]/u.test(name)) throw invalid();
  return name;
}

function dateValue(value: unknown): string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) throw invalid();
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw invalid();
  return value;
}

function assertWindow(windowStart: string, windowEnd: string, maxMonths: number): void {
  const start = new Date(`${windowStart}T00:00:00.000Z`);
  const end = new Date(`${windowEnd}T00:00:00.000Z`);
  if (end < start) throw invalid();
  const months =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (end.getUTCMonth() - start.getUTCMonth()) +
    1;
  if (months > maxMonths) {
    throw new AppError({
      code: "BACKTEST_INPUT_INVALID",
      message: "Backtest window exceeds the configured limit.",
      statusCode: 409,
      details: [],
    });
  }
}

function baselineValue(value: unknown): BacktestBaseline {
  if (
    value !== "no_commitment" &&
    value !== "last_month_steady_state" &&
    value !== "seventy_percent_utilization" &&
    value !== "custom"
  ) {
    throw invalid();
  }
  return value;
}

function statusValue(value: unknown): BacktestRunStatus {
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

function uuidValue(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw invalid();
  return value;
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
    message: "Backtest request is invalid.",
    statusCode: 400,
    details: [],
  });
}
