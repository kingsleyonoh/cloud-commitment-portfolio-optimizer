import { AppError } from "../shared/errors.js";
import type {
  RecommendationListInput,
  RecommendationRiskBand,
  RecommendationStatus,
} from "./recommendations-types.js";

const statuses = new Set<RecommendationStatus>([
  "draft",
  "ready",
  "pending_approval",
  "approved",
  "rejected",
  "superseded",
  "executed",
  "expired",
]);
const riskBands = new Set<RecommendationRiskBand>(["low", "medium", "high", "blocked"]);

export function parseRecommendationListQuery(query: unknown): RecommendationListInput {
  const source = object(query);
  const limit = optionalLimit(source.limit);
  const status = optionalSetValue(source.status, statuses);
  const riskBand = optionalSetValue(source.risk_band, riskBands);
  const provider = optionalLiteral(source.provider, "aws");
  const instrument = optionalLiteral(source.instrument, "aws_compute_savings_plan");
  const optimizerRunId =
    source.optimizer_run_id === undefined ? undefined : uuid(source.optimizer_run_id);
  const cursor = source.cursor === undefined ? undefined : parseCursor(source.cursor);
  rejectUnknown(source, [
    "limit",
    "cursor",
    "status",
    "risk_band",
    "provider",
    "instrument",
    "optimizer_run_id",
  ]);
  return {
    limit,
    ...(cursor ? { cursor } : {}),
    ...(status ? { status } : {}),
    ...(riskBand ? { riskBand } : {}),
    ...(provider ? { provider } : {}),
    ...(instrument ? { instrument } : {}),
    ...(optimizerRunId ? { optimizerRunId } : {}),
  };
}

export function parseRecommendationId(value: unknown): string {
  return uuid(value);
}

export function parseReportSourceType(value: unknown): "recommendation" {
  if (value !== "recommendation") throw invalid();
  return "recommendation";
}

function parseCursor(value: unknown): { createdAt: string; id: string } {
  if (typeof value !== "string" || value.length > 512) throw invalid();
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    const source = object(parsed);
    return { createdAt: iso(source.created_at), id: uuid(source.id) };
  } catch {
    throw invalid();
  }
}

export function encodeRecommendationCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ created_at: createdAt, id }), "utf8").toString("base64url");
}

function optionalLimit(value: unknown): number {
  if (value === undefined) return 50;
  if (typeof value !== "string" || !/^[1-9][0-9]{0,2}$/u.test(value)) throw invalid();
  const parsed = Number(value);
  if (parsed < 1 || parsed > 120) throw invalid();
  return parsed;
}

function optionalSetValue<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !allowed.has(value as T)) throw invalid();
  return value as T;
}

function optionalLiteral<T extends string>(value: unknown, literal: T): T | undefined {
  if (value === undefined) return undefined;
  if (value !== literal) throw invalid();
  return literal;
}

function uuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  ) {
    throw invalid();
  }
  return value.toLowerCase();
}

function iso(value: unknown): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw invalid();
  return value;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}

function rejectUnknown(source: Record<string, unknown>, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  if (Object.keys(source).some((key) => !allowedSet.has(key))) throw invalid();
}

function invalid(): AppError {
  return new AppError({
    code: "VALIDATION_ERROR",
    message: "Recommendation request is invalid.",
    statusCode: 400,
    details: [],
  });
}
