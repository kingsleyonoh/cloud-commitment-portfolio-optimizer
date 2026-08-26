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

const uuid = { type: "string", format: "uuid" } as const;
const values = {
  anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }],
} as const;

export const auditLogListQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    limit: { type: "string", pattern: "^(?:[1-9]|[1-9][0-9]|100)$" },
    cursor: { type: "string", minLength: 38, maxLength: 512 },
    action: { type: "string", minLength: 1, maxLength: 200 },
    actor_type: { type: "string", enum: ["user", "api_key", "job", "system"] },
    entity_type: { type: "string", minLength: 1, maxLength: 200 },
    entity_id: uuid,
  },
} as const;

export const auditSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "actor_user_id",
    "actor_type",
    "action",
    "entity_type",
    "entity_id",
    "old_values",
    "new_values",
    "request_id",
    "created_at",
  ],
  properties: {
    id: uuid,
    actor_user_id: { anyOf: [uuid, { type: "null" }] },
    actor_type: { type: "string", enum: ["user", "api_key", "job", "system"] },
    action: { type: "string" },
    entity_type: { type: "string" },
    entity_id: { anyOf: [uuid, { type: "null" }] },
    old_values: values,
    new_values: values,
    request_id: { anyOf: [{ type: "string" }, { type: "null" }] },
    created_at: { type: "string", format: "date-time" },
  },
} as const;

export const auditLogListResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["audit", "next_cursor"],
  properties: {
    audit: { type: "array", items: auditSchema },
    next_cursor: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
} as const;

export const auditLogResponseSchemas = {
  400: errorSchema,
  401: errorSchema,
  403: errorSchema,
  429: errorSchema,
  503: errorSchema,
} as const;
