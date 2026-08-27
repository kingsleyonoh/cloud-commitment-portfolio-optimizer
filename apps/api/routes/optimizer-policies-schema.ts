const optimizerPolicyErrorSchema = {
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
        details: { type: "array", maxItems: 0 },
      },
    },
  },
} as const;

const unsignedBigint = { type: "string", pattern: "^(?:0|[1-9][0-9]{0,18})$" } as const;
const utilizationGap = {
  type: "string",
  pattern: "^(?:100(?:\\.0{1,2})?|[0-9]{1,2}(?:\\.[0-9]{1,2})?)$",
} as const;

const instrumentSchema = {
  type: "string",
  enum: [
    "aws_compute_savings_plan",
    "aws_reserved_instance",
    "azure_savings_plan",
    "azure_reservation",
    "gcp_committed_use_discount",
  ],
} as const;

const policyFields = {
  name: { type: "string", minLength: 1, maxLength: 200 },
  objective: {
    type: "string",
    enum: ["maximize_expected_savings", "minimize_downside_loss", "efficient_frontier"],
  },
  max_downside_loss_cents: unsignedBigint,
  min_expected_savings_cents: unsignedBigint,
  max_utilization_gap_pct: utilizationGap,
  approval_threshold_cents: unsignedBigint,
  allowed_instruments: {
    type: "array",
    minItems: 1,
    maxItems: 5,
    items: instrumentSchema,
  },
  config: { type: "object", additionalProperties: true },
} as const;

export const optimizerPolicyCreateBodySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "name",
    "objective",
    "max_downside_loss_cents",
    "min_expected_savings_cents",
    "max_utilization_gap_pct",
    "approval_threshold_cents",
    "allowed_instruments",
    "config",
  ],
  properties: policyFields,
} as const;

export const optimizerPolicyPatchBodySchema = {
  type: "object",
  additionalProperties: false,
  minProperties: 1,
  properties: {
    ...policyFields,
    status: { type: "string", enum: ["draft", "active", "archived"] },
  },
} as const;

export const optimizerPoliciesListQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    limit: { type: "string", pattern: "^(?:[1-9]|[1-9][0-9]|100)$" },
    cursor: { type: "string", minLength: 1, maxLength: 512 },
    status: { type: "string", enum: ["draft", "active", "archived"] },
  },
} as const;

export const optimizerPolicyPathSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: {
      type: "string",
      pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    },
  },
} as const;

export const optimizerPolicySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "name",
    "objective",
    "max_downside_loss_cents",
    "min_expected_savings_cents",
    "max_utilization_gap_pct",
    "approval_threshold_cents",
    "allowed_instruments",
    "config",
    "status",
    "created_at",
    "updated_at",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    ...policyFields,
    status: { type: "string", enum: ["draft", "active", "archived"] },
    created_at: { type: "string", format: "date-time" },
    updated_at: { type: "string", format: "date-time" },
  },
} as const;

export const optimizerPoliciesListResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["optimizer_policies", "next_cursor"],
  properties: {
    optimizer_policies: { type: "array", items: optimizerPolicySchema },
    next_cursor: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
} as const;

export const optimizerPoliciesResponseSchemas = {
  400: optimizerPolicyErrorSchema,
  401: optimizerPolicyErrorSchema,
  403: optimizerPolicyErrorSchema,
  404: optimizerPolicyErrorSchema,
  409: optimizerPolicyErrorSchema,
  413: optimizerPolicyErrorSchema,
  429: optimizerPolicyErrorSchema,
  503: optimizerPolicyErrorSchema,
} as const;
