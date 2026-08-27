import { expect, it } from "vitest";

import {
  API_KEY_ROLE,
  createApiKeyRequestContext,
  createUserRequestContext,
  USER_ROLES,
} from "../../core/tenant/request-context.js";
import { selectRequestCredential } from "../../core/tenant/request-credential.js";
import { canPerformAuthAction } from "../../core/tenant/rbac.js";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const KEY_ID = "33333333-3333-4333-8333-333333333333";
const API_KEY_HEADER_VALUE = ["ccpo", "live", "v1", "value"].join("_");
const bearer = (value: string): string => ["Bearer", value].join(" ");

it("creates frozen discriminated contexts without credential material", () => {
  const apiKey = createApiKeyRequestContext({
    tenantId: TENANT_ID,
    apiKeyId: KEY_ID,
    requestId: "request-api-key",
  });
  const user = createUserRequestContext({
    tenantId: TENANT_ID,
    actorUserId: USER_ID,
    role: "tenant_admin",
    requestId: "request-user",
  });

  expect(apiKey).toEqual({
    tenantId: TENANT_ID,
    actorType: "api_key",
    actorUserId: null,
    apiKeyId: KEY_ID,
    role: "finops_analyst",
    requestId: "request-api-key",
  });
  expect(user).toEqual({
    tenantId: TENANT_ID,
    actorType: "user",
    actorUserId: USER_ID,
    apiKeyId: null,
    role: "tenant_admin",
    requestId: "request-user",
  });
  expect(Object.isFrozen(apiKey)).toBe(true);
  expect(Object.isFrozen(user)).toBe(true);
  expect(JSON.stringify([apiKey, user])).not.toMatch(/credential|authorization|hash|token/iu);
  expect(API_KEY_ROLE).toBe("finops_analyst");
  expect(USER_ROLES).toEqual([
    "tenant_admin",
    "finops_analyst",
    "finance_approver",
    "read_only_auditor",
  ]);
});

it("selects only the canonical X-API-Key or Bearer header location", () => {
  expect(selectRequestCredential({ "x-api-key": API_KEY_HEADER_VALUE })).toEqual({
    kind: "api_key",
    value: API_KEY_HEADER_VALUE,
  });
  expect(selectRequestCredential({ authorization: bearer("compact.value.signature") })).toEqual({
    kind: "jwt",
    value: "compact.value.signature",
  });
});

it.each([
  [{}, "AUTH_REQUIRED"],
  [{ authorization: ["Basic", "opaque"].join(" ") }, "AUTH_INVALID"],
  [{ authorization: bearer("") }, "AUTH_INVALID"],
  [{ authorization: bearer("first second") }, "AUTH_INVALID"],
  [{ "x-api-key": "   " }, "AUTH_INVALID"],
  [
    { "x-api-key": "key", authorization: bearer("compact.value.signature") },
    "AUTH_CREDENTIAL_CONFLICT",
  ],
])("rejects missing, malformed, and conflicting credentials generically", (headers, code) => {
  expect(() => selectRequestCredential(headers)).toThrowError(
    expect.objectContaining({ code, statusCode: 401, details: [] }),
  );
});

it("allows only enumerated current matrix actions and otherwise denies", () => {
  expect(canPerformAuthAction("tenant_admin", "tenant_profile.read")).toBe(true);
  expect(canPerformAuthAction("finops_analyst", "unregistered.action")).toBe(false);
  expect(canPerformAuthAction(API_KEY_ROLE, "users.read_manage", "api_key")).toBe(false);
});
