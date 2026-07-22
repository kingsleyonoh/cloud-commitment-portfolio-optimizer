export const USER_ROLES = [
  "tenant_admin",
  "finops_analyst",
  "finance_approver",
  "read_only_auditor",
] as const;

export type UserRole = (typeof USER_ROLES)[number];
export const API_KEY_ROLE = "finops_analyst" as const;

export type UserRequestContext = Readonly<{
  tenantId: string;
  actorType: "user";
  actorUserId: string;
  apiKeyId: null;
  role: UserRole;
  requestId: string;
}>;

export type ApiKeyRequestContext = Readonly<{
  tenantId: string;
  actorType: "api_key";
  actorUserId: null;
  apiKeyId: string;
  role: typeof API_KEY_ROLE;
  requestId: string;
}>;

export type RequestContext = UserRequestContext | ApiKeyRequestContext;

export function createUserRequestContext(input: {
  tenantId: string;
  actorUserId: string;
  role: UserRole;
  requestId: string;
}): UserRequestContext {
  return Object.freeze({
    tenantId: input.tenantId,
    actorType: "user",
    actorUserId: input.actorUserId,
    apiKeyId: null,
    role: input.role,
    requestId: input.requestId,
  });
}

export function createApiKeyRequestContext(input: {
  tenantId: string;
  apiKeyId: string;
  requestId: string;
}): ApiKeyRequestContext {
  return Object.freeze({
    tenantId: input.tenantId,
    actorType: "api_key",
    actorUserId: null,
    apiKeyId: input.apiKeyId,
    role: API_KEY_ROLE,
    requestId: input.requestId,
  });
}

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && USER_ROLES.some((role) => role === value);
}
