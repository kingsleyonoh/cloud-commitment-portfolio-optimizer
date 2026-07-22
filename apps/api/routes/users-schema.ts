const roleSchema = {
  type: "string",
  enum: ["tenant_admin", "finops_analyst", "finance_approver", "read_only_auditor"],
} as const;

export const tenantUserSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "email", "name", "role", "is_active", "created_at", "updated_at"],
  properties: {
    id: { type: "string", format: "uuid" },
    email: { type: "string" },
    name: { type: "string" },
    role: roleSchema,
    is_active: { type: "boolean" },
    created_at: { type: "string", format: "date-time" },
    updated_at: { type: "string", format: "date-time" },
  },
} as const;

export const usersErrorSchema = {
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

export const usersListQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    limit: { type: "string", pattern: "^(?:[1-9]|[1-9][0-9]|100)$" },
    cursor: { type: "string", minLength: 1, maxLength: 512 },
  },
} as const;

export const usersListResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["users", "next_cursor"],
  properties: {
    users: { type: "array", items: tenantUserSchema },
    next_cursor: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
} as const;

export const userCreateBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["email", "name", "role"],
  properties: {
    email: { type: "string" },
    name: { type: "string" },
    role: roleSchema,
    is_active: { type: "boolean" },
  },
} as const;

export const userPasswordBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["password"],
  properties: {
    password: { type: "string", writeOnly: true },
  },
} as const;

export const userPatchBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["expected_updated_at"],
  anyOf: [
    { required: ["email"] },
    { required: ["name"] },
    { required: ["role"] },
    { required: ["is_active"] },
  ],
  properties: {
    expected_updated_at: { type: "string" },
    email: { type: "string" },
    name: { type: "string" },
    role: roleSchema,
    is_active: { type: "boolean" },
  },
} as const;

export const userPathSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: { id: { type: "string" } },
} as const;

export const userPasswordPathSchema = {
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

export const usersResponseSchemas = {
  400: usersErrorSchema,
  401: usersErrorSchema,
  403: usersErrorSchema,
  404: usersErrorSchema,
  409: usersErrorSchema,
  429: usersErrorSchema,
  503: usersErrorSchema,
} as const;

export const userPasswordResponseSchemas = {
  400: usersErrorSchema,
  401: usersErrorSchema,
  403: usersErrorSchema,
  404: usersErrorSchema,
  413: usersErrorSchema,
  429: usersErrorSchema,
  503: usersErrorSchema,
} as const;
