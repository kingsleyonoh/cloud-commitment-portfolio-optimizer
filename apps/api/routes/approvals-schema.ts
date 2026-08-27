import { recommendationSchema } from "./recommendations-schema.js";

const uuidSchema = { type: "string", format: "uuid" } as const;

const approvalStatusSchema = {
  type: "string",
  enum: ["queued", "pending", "approved", "rejected", "expired", "failed"],
} as const;

export const approvalSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "recommendation_id",
    "status",
    "requested_by_user_id",
    "assigned_to_user_id",
    "workflow_execution_id",
    "decision_reason",
    "approval_snapshot",
    "requested_at",
    "decided_at",
    "expires_at",
    "created_at",
    "updated_at",
  ],
  properties: {
    id: uuidSchema,
    recommendation_id: uuidSchema,
    status: approvalStatusSchema,
    requested_by_user_id: { anyOf: [uuidSchema, { type: "null" }] },
    assigned_to_user_id: { anyOf: [uuidSchema, { type: "null" }] },
    workflow_execution_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    decision_reason: { anyOf: [{ type: "string" }, { type: "null" }] },
    approval_snapshot: { type: "object", additionalProperties: true },
    requested_at: { type: "string" },
    decided_at: { anyOf: [{ type: "string" }, { type: "null" }] },
    expires_at: { type: "string" },
    created_at: { type: "string" },
    updated_at: { type: "string" },
  },
} as const;

export const approvalDetailSchema = {
  type: "object",
  additionalProperties: false,
  required: ["approval", "recommendation"],
  properties: {
    approval: approvalSchema,
    recommendation: recommendationSchema,
  },
} as const;

export const approvalRequestBodySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    assigned_to_user_id: uuidSchema,
    reason: { type: "string" },
  },
} as const;

export const approvalDecisionBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["decision_reason"],
  properties: {
    decision_reason: { type: "string" },
  },
} as const;

export const approvalsListQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    limit: { type: "string" },
    cursor: { type: "string" },
    status: approvalStatusSchema,
    assigned_to_user_id: uuidSchema,
    recommendation_id: uuidSchema,
  },
} as const;

export const approvalsListResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["approvals", "next_cursor"],
  properties: {
    approvals: { type: "array", items: approvalSchema },
    next_cursor: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
} as const;

export const approvalPathSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: { id: uuidSchema },
} as const;

export const approvalErrorSchema = {
  type: "object",
  additionalProperties: false,
  required: ["error"],
  properties: {
    error: {
      type: "object",
      additionalProperties: false,
      required: ["code", "message", "details"],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        details: { type: "array" },
      },
    },
  },
} as const;

export const approvalsResponseSchemas = {
  400: approvalErrorSchema,
  401: approvalErrorSchema,
  403: approvalErrorSchema,
  404: approvalErrorSchema,
  409: approvalErrorSchema,
  429: approvalErrorSchema,
  503: approvalErrorSchema,
} as const;
