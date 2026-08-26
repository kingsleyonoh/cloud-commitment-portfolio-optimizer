const scenarioErrorSchema = {
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

const uuid = {
  type: "string",
  pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
} as const;

const shockConfig = {
  type: "object",
  additionalProperties: true,
  maxProperties: 100,
} as const;

export const scenarioCreateBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "shock_config"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 200 },
    description: { type: "string", minLength: 1, maxLength: 2000 },
    base_forecast_run_id: uuid,
    shock_config: shockConfig,
  },
} as const;

export const scenariosListQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    limit: { type: "string", pattern: "^(?:[1-9]|[1-9][0-9]|100)$" },
    cursor: { type: "string", minLength: 38, maxLength: 512 },
    status: { type: "string", enum: ["draft", "ready", "archived"] },
  },
} as const;

export const scenarioPathSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: { id: uuid },
} as const;

export const scenarioSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "name",
    "description",
    "base_forecast_run_id",
    "shock_config",
    "status",
    "created_by_user_id",
    "created_at",
    "updated_at",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    name: { type: "string" },
    description: { anyOf: [{ type: "string" }, { type: "null" }] },
    base_forecast_run_id: { anyOf: [{ type: "string", format: "uuid" }, { type: "null" }] },
    shock_config: shockConfig,
    status: { type: "string", enum: ["draft", "ready", "archived"] },
    created_by_user_id: { anyOf: [{ type: "string", format: "uuid" }, { type: "null" }] },
    created_at: { type: "string", format: "date-time" },
    updated_at: { type: "string", format: "date-time" },
  },
} as const;

export const scenariosListResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["scenarios", "next_cursor"],
  properties: {
    scenarios: { type: "array", items: scenarioSchema },
    next_cursor: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
} as const;

export const scenariosResponseSchemas = {
  400: scenarioErrorSchema,
  401: scenarioErrorSchema,
  403: scenarioErrorSchema,
  404: scenarioErrorSchema,
  409: scenarioErrorSchema,
  413: scenarioErrorSchema,
  429: scenarioErrorSchema,
  503: scenarioErrorSchema,
} as const;
