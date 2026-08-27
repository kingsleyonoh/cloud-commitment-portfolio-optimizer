const cloudAccountProviderSchema = {
  type: "string",
  enum: ["aws", "azure", "gcp"],
} as const;

const tagsSchema = {
  type: "object",
  additionalProperties: true,
} as const;

export const cloudAccountSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "provider",
    "external_ref",
    "display_name",
    "currency",
    "tags",
    "is_active",
    "created_at",
    "updated_at",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    provider: cloudAccountProviderSchema,
    external_ref: { type: "string" },
    display_name: { type: "string" },
    currency: { type: "string", pattern: "^[A-Z]{3}$" },
    tags: tagsSchema,
    is_active: { type: "boolean" },
    created_at: { type: "string", format: "date-time" },
    updated_at: { type: "string", format: "date-time" },
  },
} as const;

export const cloudAccountsErrorSchema = {
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

export const cloudAccountsListQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    limit: { type: "string", pattern: "^(?:[1-9]|[1-9][0-9]|100)$" },
    cursor: { type: "string", minLength: 1, maxLength: 512 },
    provider: cloudAccountProviderSchema,
    is_active: { type: "string", enum: ["true", "false"] },
  },
} as const;

export const cloudAccountsListResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["cloud_accounts", "next_cursor"],
  properties: {
    cloud_accounts: { type: "array", items: cloudAccountSchema },
    next_cursor: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
} as const;

export const cloudAccountCreateBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["provider", "external_ref", "display_name", "currency"],
  properties: {
    provider: cloudAccountProviderSchema,
    external_ref: { type: "string" },
    display_name: { type: "string" },
    currency: { type: "string" },
    tags: tagsSchema,
  },
} as const;

export const cloudAccountPatchBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["expected_updated_at"],
  anyOf: [
    { required: ["external_ref"] },
    { required: ["display_name"] },
    { required: ["currency"] },
    { required: ["tags"] },
  ],
  properties: {
    expected_updated_at: { type: "string" },
    external_ref: { type: "string" },
    display_name: { type: "string" },
    currency: { type: "string" },
    tags: tagsSchema,
  },
} as const;

export const cloudAccountDeactivateBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["reason"],
  properties: {
    reason: { type: "string", minLength: 1, maxLength: 512 },
  },
} as const;

export const cloudAccountPathSchema = {
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

export const cloudAccountsResponseSchemas = {
  400: cloudAccountsErrorSchema,
  401: cloudAccountsErrorSchema,
  403: cloudAccountsErrorSchema,
  404: cloudAccountsErrorSchema,
  409: cloudAccountsErrorSchema,
  413: cloudAccountsErrorSchema,
  429: cloudAccountsErrorSchema,
  503: cloudAccountsErrorSchema,
} as const;
