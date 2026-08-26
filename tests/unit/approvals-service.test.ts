import { describe, expect, it, vi } from "vitest";

import { createApprovalsService } from "../../core/approvals/approvals-service.js";
import type { ApprovalsRepository } from "../../core/approvals/approvals-repository.js";
import type { ApprovalRecord } from "../../core/approvals/approvals-types.js";
import type { RecommendationRecord } from "../../core/recommendations/recommendations-types.js";
import { createUserRequestContext } from "../../core/tenant/request-context.js";

const recommendationId = "11111111-1111-4111-8111-111111111111";
const approvalId = "22222222-2222-4222-8222-222222222222";
const tenantId = "33333333-3333-4333-8333-333333333333";
const actorUserId = "44444444-4444-4444-8444-444444444444";

describe("approvals lifecycle hooks", () => {
  it("runs the request hook after the local approval write and isolates hook failures", async () => {
    const order: string[] = [];
    const repository = fakeRepository(order);
    const onApprovalRequested = vi.fn(async () => {
      order.push("request-hook");
      throw new Error("optional delivery unavailable");
    });
    const service = createApprovalsService(repository, {
      expiryHours: 24,
      now: () => new Date("2026-08-26T00:00:00.000Z"),
      onApprovalRequested,
    });

    const approval = await service.requestApproval(context(), recommendationId, {
      reason: "Review the monthly commitment.",
    });

    expect(approval.id).toBe(approvalId);
    expect(onApprovalRequested).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId, approval: expect.objectContaining({ id: approvalId }) }),
    );
    expect(order).toEqual(["create", "request-hook"]);
  });

  it("runs the decision hook after the local decision and keeps the decision available on failure", async () => {
    const order: string[] = [];
    const repository = fakeRepository(order);
    const onApprovalDecided = vi.fn(async () => {
      order.push("decision-hook");
      throw new Error("optional delivery unavailable");
    });
    const service = createApprovalsService(repository, {
      expiryHours: 24,
      onApprovalDecided,
    });

    const detail = await service.approve(context(), approvalId, {
      decision_reason: "Approved after finance review.",
    });

    expect(detail.approval.status).toBe("approved");
    expect(onApprovalDecided).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        approval: expect.objectContaining({ status: "approved" }),
      }),
    );
    expect(order).toEqual(["approve", "recommendation", "decision-hook"]);
  });
});

function fakeRepository(order: string[]): ApprovalsRepository {
  return {
    createPending: vi.fn(async () => {
      order.push("create");
      return pendingApproval;
    }),
    list: vi.fn(),
    get: vi.fn(),
    approve: vi.fn(async () => {
      order.push("approve");
      return approvedApproval;
    }),
    reject: vi.fn(),
    getRecommendation: vi.fn(async () => {
      order.push("recommendation");
      return recommendation;
    }),
    expireDue: vi.fn(),
    setWorkflowExecutionId: vi.fn(),
  };
}

function context() {
  return createUserRequestContext({
    tenantId,
    actorUserId,
    role: "finance_approver",
    requestId: "request-1",
  });
}

const recommendation = {
  id: recommendationId,
  optimizerRunId: "55555555-5555-4555-8555-555555555555",
  recommendationType: "buy",
  provider: "aws",
  instrument: "aws_compute_savings_plan",
  serviceCode: "AmazonEC2",
  region: "us-east-1",
  termMonths: 12,
  commitmentAmountCents: "10000",
  expectedSavingsCents: "1200",
  p95DownsideLossCents: "300",
  utilizationP50Pct: "85.00",
  utilizationP95Pct: "95.00",
  confidenceScore: "0.9000",
  riskBand: "low",
  status: "pending_approval",
  explanation: {},
  approvalRequired: true,
  createdAt: "2026-08-26T00:00:00.000000Z",
  updatedAt: "2026-08-26T00:00:00.000000Z",
} satisfies RecommendationRecord;

const pendingApproval = {
  id: approvalId,
  recommendationId,
  status: "pending",
  requestedByUserId: actorUserId,
  assignedToUserId: null,
  workflowExecutionId: null,
  decisionReason: null,
  approvalSnapshot: { recommendation: {}, approval: {} },
  requestedAt: "2026-08-26T00:00:00.000000Z",
  decidedAt: null,
  expiresAt: "2026-08-27T00:00:00.000000Z",
  createdAt: "2026-08-26T00:00:00.000000Z",
  updatedAt: "2026-08-26T00:00:00.000000Z",
} satisfies ApprovalRecord;

const approvedApproval = {
  ...pendingApproval,
  status: "approved",
  decisionReason: "Approved after finance review.",
  decidedAt: "2026-08-26T01:00:00.000000Z",
} satisfies ApprovalRecord;
