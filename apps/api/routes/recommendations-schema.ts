const uuidSchema = { type: "string", format: "uuid" } as const;
const decimalStringSchema = { type: "string", pattern: "^(0|[1-9][0-9]*)$" } as const;
const percentStringSchema = {
  type: "string",
  pattern: "^(0|[1-9][0-9]{0,2})\\.[0-9]{2,4}$",
} as const;
const recommendationStatusSchema = {
  type: "string",
  enum: [
    "draft",
    "ready",
    "pending_approval",
    "approved",
    "rejected",
    "superseded",
    "executed",
    "expired",
  ],
} as const;
const riskBandSchema = { type: "string", enum: ["low", "medium", "high", "blocked"] } as const;
const providerSchema = { type: "string", enum: ["aws", "azure", "gcp"] } as const;
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

export const recommendationSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "optimizer_run_id",
    "recommendation_type",
    "provider",
    "instrument",
    "service_code",
    "region",
    "term_months",
    "commitment_amount_cents",
    "expected_savings_cents",
    "p95_downside_loss_cents",
    "utilization_p50_pct",
    "utilization_p95_pct",
    "confidence_score",
    "risk_band",
    "status",
    "explanation",
    "approval_required",
    "created_at",
    "updated_at",
  ],
  properties: {
    id: uuidSchema,
    optimizer_run_id: uuidSchema,
    recommendation_type: {
      type: "string",
      enum: ["buy", "renew", "resize", "sell_or_exchange", "no_action", "manual_review"],
    },
    provider: providerSchema,
    instrument: instrumentSchema,
    service_code: { type: "string" },
    region: { type: "string" },
    term_months: { type: "integer" },
    commitment_amount_cents: decimalStringSchema,
    expected_savings_cents: decimalStringSchema,
    p95_downside_loss_cents: decimalStringSchema,
    utilization_p50_pct: percentStringSchema,
    utilization_p95_pct: percentStringSchema,
    confidence_score: percentStringSchema,
    risk_band: riskBandSchema,
    status: recommendationStatusSchema,
    explanation: { type: "object", additionalProperties: true },
    approval_required: { type: "boolean" },
    created_at: { type: "string" },
    updated_at: { type: "string" },
  },
} as const;

export const reportSummarySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "source_type",
    "source_id",
    "status",
    "rendered_html_uri",
    "rendered_pdf_uri",
    "created_at",
    "updated_at",
  ],
  properties: {
    id: uuidSchema,
    source_type: { type: "string", enum: ["recommendation"] },
    source_id: uuidSchema,
    status: { type: "string", enum: ["queued", "rendered", "failed", "archived"] },
    rendered_html_uri: { anyOf: [{ type: "string" }, { type: "null" }] },
    rendered_pdf_uri: { anyOf: [{ type: "string" }, { type: "null" }] },
    created_at: { type: "string" },
    updated_at: { type: "string" },
  },
} as const;

export const recommendationDetailSchema = {
  type: "object",
  additionalProperties: false,
  required: ["recommendation", "report_summary"],
  properties: {
    recommendation: recommendationSchema,
    report_summary: { anyOf: [reportSummarySchema, { type: "null" }] },
  },
} as const;

export const recommendationsListQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    limit: { type: "string" },
    cursor: { type: "string" },
    status: recommendationStatusSchema,
    risk_band: riskBandSchema,
    provider: providerSchema,
    instrument: instrumentSchema,
    optimizer_run_id: uuidSchema,
  },
} as const;

export const recommendationsListResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["recommendations", "next_cursor"],
  properties: {
    recommendations: { type: "array", items: recommendationSchema },
    next_cursor: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
} as const;

export const recommendationPathSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: { id: uuidSchema },
} as const;

export const recommendationErrorSchema = {
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

export const recommendationsResponseSchemas = {
  400: recommendationErrorSchema,
  401: recommendationErrorSchema,
  403: recommendationErrorSchema,
  404: recommendationErrorSchema,
  429: recommendationErrorSchema,
  503: recommendationErrorSchema,
} as const;
