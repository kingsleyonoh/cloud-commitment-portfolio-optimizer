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
        details: { type: "array", maxItems: 0 },
      },
    },
  },
} as const;

const metadataSchema = {
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

export const apiKeyRotationBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["api_key_id"],
  properties: {
    api_key_id: { type: "string", format: "uuid" },
    note: { type: "string", minLength: 1, maxLength: 200 },
  },
} as const;

export const apiKeyRotationResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["revoked_api_key", "replacement_api_key", "audit_id", "apiKey"],
  properties: {
    revoked_api_key: metadataSchema,
    replacement_api_key: metadataSchema,
    audit_id: { type: "string", format: "uuid" },
    apiKey: { type: "string", writeOnly: true },
  },
} as const;

export const apiKeyRotationResponseSchemas = {
  400: errorSchema,
  401: errorSchema,
  403: errorSchema,
  404: errorSchema,
  413: errorSchema,
  429: errorSchema,
  503: errorSchema,
} as const;
