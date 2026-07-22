const roleSchema = {
  type: "string",
  enum: ["tenant_admin", "finops_analyst", "finance_approver", "read_only_auditor"],
} as const;

export const authSessionMetadataSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "user_id",
    "tenant_id",
    "role",
    "access_expires_at",
    "refresh_idle_expires_at",
    "refresh_absolute_expires_at",
  ],
  properties: {
    user_id: { type: "string", format: "uuid" },
    tenant_id: { type: "string", format: "uuid" },
    role: roleSchema,
    access_expires_at: { type: "string", format: "date-time" },
    refresh_idle_expires_at: { type: "string", format: "date-time" },
    refresh_absolute_expires_at: { type: "string", format: "date-time" },
  },
} as const;

export const authSessionResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["session"],
  properties: { session: authSessionMetadataSchema },
} as const;

export const authLoginBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["tenant_id", "email", "password"],
  properties: {
    tenant_id: {
      type: "string",
      pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    },
    email: { type: "string" },
    password: { type: "string", writeOnly: true },
  },
} as const;

export const authSessionErrorSchema = {
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

const errors = {
  400: authSessionErrorSchema,
  401: authSessionErrorSchema,
  403: authSessionErrorSchema,
  413: authSessionErrorSchema,
  429: authSessionErrorSchema,
  503: authSessionErrorSchema,
} as const;

export const authLoginResponses = { 200: authSessionResponseSchema, ...errors } as const;
export const authRefreshResponses = { 200: authSessionResponseSchema, ...errors } as const;
export const authLogoutResponses = { 204: { type: "null" }, ...errors } as const;
