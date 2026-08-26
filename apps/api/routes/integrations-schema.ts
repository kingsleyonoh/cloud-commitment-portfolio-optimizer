const errorSchema = {
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

export const integrationStatusSchema = {
  type: "object",
  additionalProperties: false,
  required: ["target_system", "enabled", "configured", "state", "detail"],
  properties: {
    target_system: { type: "string" },
    enabled: { type: "boolean" },
    configured: { type: "boolean" },
    state: { type: "string", enum: ["disabled", "ready", "degraded", "unsupported"] },
    detail: { type: "string" },
  },
} as const;

export const integrationsStatusResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["integrations"],
  properties: { integrations: { type: "array", items: integrationStatusSchema } },
} as const;

export const integrationTestBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["target_system"],
  properties: {
    target_system: {
      type: "string",
      enum: ["notification_hub", "workflow_engine", "invoice_reconciliation_engine"],
    },
  },
} as const;

export const ecosystemEventSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "event_type",
    "event_id",
    "status",
    "target_system",
    "next_attempt_at",
    "attempt_count",
    "created_at",
    "updated_at",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    event_type: { type: "string" },
    event_id: { type: "string" },
    status: { type: "string", enum: ["queued", "sent", "failed", "disabled", "retrying"] },
    target_system: { type: "string" },
    next_attempt_at: { anyOf: [{ type: "string" }, { type: "null" }] },
    attempt_count: { type: "integer", minimum: 0 },
    created_at: { type: "string" },
    updated_at: { type: "string" },
  },
} as const;

export const integrationsResponseSchemas = {
  400: errorSchema,
  401: errorSchema,
  403: errorSchema,
  404: errorSchema,
  409: errorSchema,
  429: errorSchema,
  503: errorSchema,
} as const;
