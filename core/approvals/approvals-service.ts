import { AppError } from "../shared/errors.js";
import type { RequestContext } from "../tenant/request-context.js";
import { toRecommendation } from "../recommendations/recommendations-service.js";
import {
  encodeApprovalCursor,
  parseApprovalDecisionBody,
  parseApprovalId,
  parseApprovalListQuery,
  parseApprovalRequestBody,
} from "./approvals-input.js";
import type { ApprovalsRepository } from "./approvals-repository.js";
import type {
  Approval,
  ApprovalDetail,
  ApprovalListPage,
  ApprovalRecord,
} from "./approvals-types.js";

export interface ApprovalsService {
  requestApproval(context: RequestContext, id: unknown, body: unknown): Promise<Approval>;
  list(context: RequestContext, query: unknown): Promise<ApprovalListPage>;
  get(context: RequestContext, id: unknown): Promise<ApprovalDetail>;
  approve(context: RequestContext, id: unknown, body: unknown): Promise<ApprovalDetail>;
  reject(context: RequestContext, id: unknown, body: unknown): Promise<ApprovalDetail>;
}

export interface ApprovalsServiceOptions {
  expiryHours: number;
  now?: () => Date;
  onApprovalRequested?: (input: { tenantId: string; approval: ApprovalRecord }) => Promise<void>;
  onApprovalDecided?: (input: { tenantId: string; approval: ApprovalRecord }) => Promise<void>;
}

export function createApprovalsService(
  repository: ApprovalsRepository,
  options: ApprovalsServiceOptions,
): ApprovalsService {
  const now = options.now ?? (() => new Date());
  return {
    requestApproval: (context, id, body) =>
      requestApproval(
        repository,
        options.expiryHours,
        now,
        options.onApprovalRequested,
        context,
        id,
        body,
      ),
    list: (context, query) => list(repository, context, query),
    get: (context, id) => get(repository, context, id),
    approve: (context, id, body) =>
      decide(repository, options.onApprovalDecided, context, id, body, "approve"),
    reject: (context, id, body) =>
      decide(repository, options.onApprovalDecided, context, id, body, "reject"),
  };
}

async function requestApproval(
  repository: ApprovalsRepository,
  expiryHours: number,
  now: () => Date,
  onApprovalRequested: ApprovalsServiceOptions["onApprovalRequested"],
  context: RequestContext,
  id: unknown,
  body: unknown,
): Promise<Approval> {
  const input = parseApprovalRequestBody(id, body);
  const expiresAt = new Date(now().getTime() + expiryHours * 60 * 60 * 1000);
  const row = await safe(() =>
    repository.createPending(context.tenantId, {
      recommendationId: input.recommendationId,
      requestedByUserId: context.actorUserId,
      assignedToUserId: input.assignedToUserId ?? null,
      reason: input.reason ?? null,
      expiresAt,
    }),
  );
  await runHook(onApprovalRequested, { tenantId: context.tenantId, approval: row });
  return toApproval(row);
}

async function list(
  repository: ApprovalsRepository,
  context: RequestContext,
  query: unknown,
): Promise<ApprovalListPage> {
  const input = parseApprovalListQuery(query);
  const rows = await safe(() => repository.list(context.tenantId, input));
  const page = rows.slice(0, input.limit);
  const boundary = rows.length > input.limit ? page.at(-1) : undefined;
  return {
    approvals: page.map(toApproval),
    next_cursor: boundary ? encodeApprovalCursor(boundary.requestedAt, boundary.id) : null,
  };
}

async function get(
  repository: ApprovalsRepository,
  context: RequestContext,
  idValue: unknown,
): Promise<ApprovalDetail> {
  const id = parseApprovalId(idValue);
  const approval = await safe(() => repository.get(context.tenantId, id));
  if (!approval) throw notFound();
  const recommendation = await safe(() =>
    repository.getRecommendation(context.tenantId, approval.recommendationId),
  );
  if (!recommendation) throw notFound();
  return { approval: toApproval(approval), recommendation: toRecommendation(recommendation) };
}

async function decide(
  repository: ApprovalsRepository,
  onApprovalDecided: ApprovalsServiceOptions["onApprovalDecided"],
  context: RequestContext,
  idValue: unknown,
  body: unknown,
  decision: "approve" | "reject",
): Promise<ApprovalDetail> {
  const input = parseApprovalDecisionBody(idValue, body);
  const approval = await safe(() =>
    decision === "approve"
      ? repository.approve(context.tenantId, input)
      : repository.reject(context.tenantId, input),
  );
  if (!approval) throw notFound();
  const recommendation = await safe(() =>
    repository.getRecommendation(context.tenantId, approval.recommendationId),
  );
  if (!recommendation) throw notFound();
  await runHook(onApprovalDecided, { tenantId: context.tenantId, approval });
  return { approval: toApproval(approval), recommendation: toRecommendation(recommendation) };
}

async function runHook(
  hook: ((input: { tenantId: string; approval: ApprovalRecord }) => Promise<void>) | undefined,
  input: { tenantId: string; approval: ApprovalRecord },
): Promise<void> {
  if (!hook) return;
  try {
    await hook(input);
  } catch {
    // Optional notification and adapter mirrors never make local approval state unavailable.
  }
}

function toApproval(row: ApprovalRecord): Approval {
  return {
    id: row.id,
    recommendation_id: row.recommendationId,
    status: row.status,
    requested_by_user_id: row.requestedByUserId,
    assigned_to_user_id: row.assignedToUserId,
    workflow_execution_id: row.workflowExecutionId,
    decision_reason: row.decisionReason,
    approval_snapshot: row.approvalSnapshot,
    requested_at: row.requestedAt,
    decided_at: row.decidedAt,
    expires_at: row.expiresAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

async function safe<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError({
      code: "APPROVALS_UNAVAILABLE",
      message: "Approvals are temporarily unavailable.",
      statusCode: 503,
      details: [],
    });
  }
}

function notFound(): AppError {
  return new AppError({
    code: "NOT_FOUND",
    message: "The requested resource was not found.",
    statusCode: 404,
    details: [],
  });
}
