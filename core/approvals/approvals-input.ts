import { AppError } from "../shared/errors.js";
import type {
  ApprovalDecisionInput,
  ApprovalListInput,
  ApprovalRequestInput,
  ApprovalStatus,
} from "./approvals-types.js";

const statuses = new Set<ApprovalStatus>([
  "queued",
  "pending",
  "approved",
  "rejected",
  "expired",
  "failed",
]);

export function parseApprovalRequestBody(
  recommendationIdValue: unknown,
  body: unknown,
): ApprovalRequestInput {
  const source = object(body);
  rejectUnknown(source, ["assigned_to_user_id", "reason"]);
  const recommendationId = uuid(recommendationIdValue);
  const assignedToUserId =
    source.assigned_to_user_id === undefined ? undefined : uuid(source.assigned_to_user_id);
  const reason = source.reason === undefined ? undefined : boundedText(source.reason, 2000);
  return {
    recommendationId,
    ...(assignedToUserId ? { assignedToUserId } : {}),
    ...(reason ? { reason } : {}),
  };
}

export function parseApprovalListQuery(query: unknown): ApprovalListInput {
  if (!query || typeof query !== "object" || Array.isArray(query)) return { limit: 50 };
  const source = query as Record<string, unknown>;
  rejectUnknown(source, ["limit", "cursor", "status", "assigned_to_user_id", "recommendation_id"]);
  const limit = optionalLimit(source.limit);
  const cursor = source.cursor === undefined ? undefined : parseCursor(source.cursor);
  const status = source.status === undefined ? undefined : statusValue(source.status);
  const assignedToUserId =
    source.assigned_to_user_id === undefined ? undefined : uuid(source.assigned_to_user_id);
  const recommendationId =
    source.recommendation_id === undefined ? undefined : uuid(source.recommendation_id);
  return {
    limit,
    ...(cursor ? { cursor } : {}),
    ...(status ? { status } : {}),
    ...(assignedToUserId ? { assignedToUserId } : {}),
    ...(recommendationId ? { recommendationId } : {}),
  };
}

export function parseApprovalId(value: unknown): string {
  return uuid(value);
}

export function parseApprovalDecisionBody(
  approvalIdValue: unknown,
  body: unknown,
): ApprovalDecisionInput {
  const source = object(body);
  rejectUnknown(source, ["decision_reason"]);
  return {
    approvalId: uuid(approvalIdValue),
    decisionReason: boundedText(source.decision_reason, 2000),
  };
}

export function encodeApprovalCursor(requestedAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ requested_at: requestedAt, id }), "utf8").toString(
    "base64url",
  );
}

function parseCursor(value: unknown): { requestedAt: string; id: string } {
  if (typeof value !== "string" || value.length > 512) throw invalid();
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    const source = object(parsed);
    return { requestedAt: iso(source.requested_at), id: uuid(source.id) };
  } catch {
    throw invalid();
  }
}

function optionalLimit(value: unknown): number {
  if (value === undefined) return 50;
  if (typeof value !== "string" || !/^[1-9][0-9]{0,2}$/u.test(value)) throw invalid();
  const parsed = Number(value);
  if (parsed < 1 || parsed > 120) throw invalid();
  return parsed;
}

function statusValue(value: unknown): ApprovalStatus {
  if (typeof value !== "string" || !statuses.has(value as ApprovalStatus)) throw invalid();
  return value as ApprovalStatus;
}

function boundedText(value: unknown, max: number): string {
  if (typeof value !== "string") throw invalid();
  const normalized = value.normalize("NFC").trim();
  if (normalized.length === 0 || normalized.length > max || hasControlCharacter(normalized)) {
    throw invalid();
  }
  return normalized;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
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
    message: "Approval request is invalid.",
    statusCode: 400,
    details: [],
  });
}
