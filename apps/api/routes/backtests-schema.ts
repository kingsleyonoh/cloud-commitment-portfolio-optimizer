const backtestErrorSchema = {
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

const uuidSchema = {
  type: "string",
  pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
} as const;

const baselineSchema = {
  type: "string",
  enum: ["no_commitment", "last_month_steady_state", "seventy_percent_utilization", "custom"],
} as const;

const statusSchema = {
  type: "string",
  enum: ["queued", "running", "completed", "failed", "cancelled"],
} as const;

export const backtestCreateBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["policy_id", "window_start", "window_end"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 200 },
    policy_id: uuidSchema,
    baseline: baselineSchema,
    window_start: { type: "string", format: "date" },
    window_end: { type: "string", format: "date" },
  },
} as const;

export const backtestsListQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    limit: { type: "string", pattern: "^(?:[1-9]|[1-9][0-9]|100)$" },
    status: statusSchema,
    baseline: baselineSchema,
    policy_id: uuidSchema,
  },
} as const;

export const backtestRunSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "name",
    "policy_id",
    "baseline",
    "window_start",
    "window_end",
    "status",
    "input_snapshot_uri",
    "output_uri",
    "metrics",
    "error_details",
    "created_by_user_id",
    "created_at",
    "updated_at",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    name: { type: "string" },
    policy_id: { type: "string", format: "uuid" },
    baseline: baselineSchema,
    window_start: { type: "string", format: "date" },
    window_end: { type: "string", format: "date" },
    status: statusSchema,
    input_snapshot_uri: { type: "string" },
    output_uri: { anyOf: [{ type: "string" }, { type: "null" }] },
    metrics: { type: "object", additionalProperties: true },
    error_details: { type: "object", additionalProperties: true },
    created_by_user_id: { anyOf: [{ type: "string", format: "uuid" }, { type: "null" }] },
    created_at: { type: "string", format: "date-time" },
    updated_at: { type: "string", format: "date-time" },
  },
} as const;

export const backtestDetailSchema = {
  type: "object",
  additionalProperties: false,
  required: ["backtest"],
  properties: { backtest: backtestRunSchema },
} as const;

export const backtestsListResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["backtests"],
  properties: {
    backtests: { type: "array", items: backtestRunSchema },
  },
} as const;

export const backtestPathSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: { id: uuidSchema },
} as const;

export const backtestsResponseSchemas = {
  400: backtestErrorSchema,
  401: backtestErrorSchema,
  403: backtestErrorSchema,
  404: backtestErrorSchema,
  409: backtestErrorSchema,
  413: backtestErrorSchema,
  429: backtestErrorSchema,
  503: backtestErrorSchema,
} as const;
