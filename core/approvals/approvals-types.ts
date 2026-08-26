import type { Recommendation } from "../recommendations/recommendations-types.js";

export type ApprovalStatus = "queued" | "pending" | "approved" | "rejected" | "expired" | "failed";

export type ApprovalRecord = Readonly<{
  id: string;
  recommendationId: string;
  status: ApprovalStatus;
  requestedByUserId: string | null;
  assignedToUserId: string | null;
  workflowExecutionId: string | null;
  decisionReason: string | null;
  approvalSnapshot: Record<string, unknown>;
  requestedAt: string;
  decidedAt: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}>;

export type Approval = Readonly<{
  id: string;
  recommendation_id: string;
  status: ApprovalStatus;
  requested_by_user_id: string | null;
  assigned_to_user_id: string | null;
  workflow_execution_id: string | null;
  decision_reason: string | null;
  approval_snapshot: Record<string, unknown>;
  requested_at: string;
  decided_at: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
}>;

export type ApprovalDetail = Readonly<{
  approval: Approval;
  recommendation: Recommendation;
}>;

export type ApprovalCursorBoundary = Readonly<{ requestedAt: string; id: string }>;

export type ApprovalListInput = Readonly<{
  limit: number;
  cursor?: ApprovalCursorBoundary;
  status?: ApprovalStatus;
  assignedToUserId?: string;
  recommendationId?: string;
}>;

export type ApprovalListPage = Readonly<{
  approvals: readonly Approval[];
  next_cursor: string | null;
}>;

export type ApprovalRequestInput = Readonly<{
  recommendationId: string;
  assignedToUserId?: string;
  reason?: string;
}>;

export type ApprovalDecisionInput = Readonly<{
  approvalId: string;
  decisionReason: string;
}>;

export type ApprovalInsertInput = Readonly<{
  recommendationId: string;
  requestedByUserId: string | null;
  assignedToUserId: string | null;
  reason: string | null;
  expiresAt: Date;
}>;

export type ApprovalExpiryResult = Readonly<{
  processed: boolean;
  approvalIds: readonly string[];
  recommendationIds: readonly string[];
}>;
