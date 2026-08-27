export const apiKeyMetadataSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "note", "created_at", "revoked_at"],
  properties: {
    id: { type: "string", format: "uuid" },
    note: { anyOf: [{ type: "string" }, { type: "null" }] },
    created_at: { type: "string", format: "date-time" },
    revoked_at: { anyOf: [{ type: "string", format: "date-time" }, { type: "null" }] },
  },
} as const;

export const apiKeyMetadataListQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    limit: { type: "string", pattern: "^(?:[1-9]|[1-9][0-9]|100)$" },
    cursor: { type: "string", minLength: 1, maxLength: 512 },
  },
} as const;

export const apiKeyMetadataListResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["api_keys", "next_cursor"],
  properties: {
    api_keys: { type: "array", items: apiKeyMetadataSchema },
    next_cursor: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
} as const;

export const apiKeyMetadataErrorSchema = {
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

export const apiKeyMetadataResponseSchemas = {
  400: apiKeyMetadataErrorSchema,
  401: apiKeyMetadataErrorSchema,
  403: apiKeyMetadataErrorSchema,
  429: apiKeyMetadataErrorSchema,
  503: apiKeyMetadataErrorSchema,
} as const;
