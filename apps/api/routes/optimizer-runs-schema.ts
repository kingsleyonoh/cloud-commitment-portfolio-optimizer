const optimizerRunErrorSchema = {
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

export const optimizerRunCreateBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["forecast_run_id", "optimizer_policy_id"],
  properties: {
    forecast_run_id: uuidSchema,
    scenario_id: uuidSchema,
    optimizer_policy_id: uuidSchema,
    provider: { type: "string", const: "aws" },
    instrument: { type: "string", const: "aws_compute_savings_plan" },
    price_table_version_ids: {
      type: "array",
      minItems: 1,
      maxItems: 16,
      items: uuidSchema,
    },
  },
} as const;

export const optimizerRunSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "forecast_run_id",
    "scenario_id",
    "optimizer_policy_id",
    "provider",
    "instrument",
    "price_table_version_ids",
    "status",
    "random_seed",
    "input_snapshot_uri",
    "output_uri",
    "frontier_uri",
    "infeasibility_details",
    "error_details",
    "created_by_user_id",
    "created_at",
    "updated_at",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    forecast_run_id: { type: "string", format: "uuid" },
    scenario_id: { anyOf: [{ type: "string", format: "uuid" }, { type: "null" }] },
    optimizer_policy_id: { type: "string", format: "uuid" },
    provider: { type: "string", const: "aws" },
    instrument: { type: "string", const: "aws_compute_savings_plan" },
    price_table_version_ids: { type: "array", items: { type: "string", format: "uuid" } },
    status: {
      type: "string",
      enum: ["queued", "running", "completed", "failed", "infeasible", "cancelled"],
    },
    random_seed: { type: "string", pattern: "^-?(?:0|[1-9][0-9]{0,18})$" },
    input_snapshot_uri: { type: "string" },
    output_uri: { anyOf: [{ type: "string" }, { type: "null" }] },
    frontier_uri: { anyOf: [{ type: "string" }, { type: "null" }] },
    infeasibility_details: { type: "object", additionalProperties: true },
    error_details: { type: "object", additionalProperties: true },
    created_by_user_id: { anyOf: [{ type: "string", format: "uuid" }, { type: "null" }] },
    created_at: { type: "string", format: "date-time" },
    updated_at: { type: "string", format: "date-time" },
  },
} as const;

export const optimizerRunDetailSchema = {
  type: "object",
  additionalProperties: false,
  required: ["optimizer_run", "frontier_summary"],
  properties: {
    optimizer_run: optimizerRunSchema,
    frontier_summary: {
      anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }],
    },
  },
} as const;

export const optimizerRunPathSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: { id: uuidSchema },
} as const;

export const optimizerRunsResponseSchemas = {
  400: optimizerRunErrorSchema,
  401: optimizerRunErrorSchema,
  403: optimizerRunErrorSchema,
  404: optimizerRunErrorSchema,
  409: optimizerRunErrorSchema,
  413: optimizerRunErrorSchema,
  429: optimizerRunErrorSchema,
  503: optimizerRunErrorSchema,
} as const;
