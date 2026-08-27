const forecastErrorSchema = {
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

export const forecastModelCreateBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "provider_scope", "service_scope", "horizon_months", "method", "config"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 200 },
    provider_scope: {
      type: "array",
      minItems: 1,
      maxItems: 1,
      items: { type: "string", const: "aws" },
    },
    service_scope: { type: "array", minItems: 1, maxItems: 100, items: { type: "string" } },
    horizon_months: { type: "integer", enum: [1, 3, 6, 12, 24, 36] },
    method: { type: "string", const: "seasonal_naive" },
    config: { type: "object", additionalProperties: true },
  },
} as const;

export const forecastRunCreateBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["forecast_model_id", "input_window_start", "input_window_end", "horizon_months"],
  properties: {
    forecast_model_id: { type: "string", format: "uuid" },
    input_window_start: { type: "string", pattern: "^[0-9]{4}-(?:0[1-9]|1[0-2])-[0-3][0-9]$" },
    input_window_end: { type: "string", pattern: "^[0-9]{4}-(?:0[1-9]|1[0-2])-[0-3][0-9]$" },
    horizon_months: { type: "integer", enum: [1, 3, 6, 12, 24, 36] },
    random_seed: { type: "string", pattern: "^-?(?:0|[1-9][0-9]{0,18})$" },
  },
} as const;

export const forecastModelsListQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    limit: { type: "string", pattern: "^(?:[1-9]|[1-9][0-9]|100)$" },
    cursor: { type: "string", minLength: 1, maxLength: 512 },
    status: { type: "string", enum: ["draft", "active", "archived"] },
    method: { type: "string", const: "seasonal_naive" },
  },
} as const;

export const forecastRunsListQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    limit: { type: "string", pattern: "^(?:[1-9]|[1-9][0-9]|100)$" },
    cursor: { type: "string", minLength: 1, maxLength: 512 },
    status: { type: "string", enum: ["queued", "running", "completed", "failed", "cancelled"] },
    forecast_model_id: { type: "string", format: "uuid" },
  },
} as const;

export const forecastPathSchema = {
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

export const forecastModelSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "name",
    "provider_scope",
    "service_scope",
    "horizon_months",
    "method",
    "config",
    "status",
    "created_by_user_id",
    "created_at",
    "updated_at",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    name: { type: "string" },
    provider_scope: { type: "array", items: { type: "string", const: "aws" } },
    service_scope: { type: "array", items: { type: "string" } },
    horizon_months: { type: "integer" },
    method: { type: "string", const: "seasonal_naive" },
    config: { type: "object", additionalProperties: true },
    status: { type: "string", enum: ["draft", "active", "archived"] },
    created_by_user_id: { anyOf: [{ type: "string", format: "uuid" }, { type: "null" }] },
    created_at: { type: "string", format: "date-time" },
    updated_at: { type: "string", format: "date-time" },
  },
} as const;

export const forecastRunSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "forecast_model_id",
    "status",
    "input_window_start",
    "input_window_end",
    "horizon_months",
    "random_seed",
    "output_uri",
    "quality_metrics",
    "error_details",
    "created_at",
    "updated_at",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    forecast_model_id: { type: "string", format: "uuid" },
    status: { type: "string", enum: ["queued", "running", "completed", "failed", "cancelled"] },
    input_window_start: { type: "string" },
    input_window_end: { type: "string" },
    horizon_months: { type: "integer" },
    random_seed: { type: "string" },
    output_uri: { anyOf: [{ type: "string" }, { type: "null" }] },
    quality_metrics: { type: "object", additionalProperties: true },
    error_details: { type: "object", additionalProperties: true },
    created_at: { type: "string", format: "date-time" },
    updated_at: { type: "string", format: "date-time" },
  },
} as const;

export const forecastModelsListResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["forecast_models", "next_cursor"],
  properties: {
    forecast_models: { type: "array", items: forecastModelSchema },
    next_cursor: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
} as const;

export const forecastRunsListResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["forecast_runs", "next_cursor"],
  properties: {
    forecast_runs: { type: "array", items: forecastRunSchema },
    next_cursor: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
} as const;

export const forecastResponseSchemas = {
  400: forecastErrorSchema,
  401: forecastErrorSchema,
  403: forecastErrorSchema,
  404: forecastErrorSchema,
  413: forecastErrorSchema,
  429: forecastErrorSchema,
  503: forecastErrorSchema,
} as const;
