import { expect, it } from "vitest";

import type { ArgonExecutor } from "../../core/tenant/argon-executor.js";
import { createArgonExecutor } from "../../core/tenant/argon-executor.js";
import { resolveAuthClientIp } from "../../core/tenant/auth-client-ip.js";
import { authError } from "../../core/tenant/auth-errors.js";
import { assertAccessCookieProof } from "../../core/tenant/auth-session-csrf.js";
import {
  createOpaqueSecret,
  digestSecretBase64url,
} from "../../core/tenant/auth-session-crypto.js";
import {
  createAuthSessionLimiter,
  loginAccountBucket,
} from "../../core/tenant/auth-session-limiter.js";
import { createAuthSessionService } from "../../core/tenant/auth-session-service.js";
import { hashPassword } from "../../core/tenant/password-credential.js";
import { selectRequestCredential } from "../../core/tenant/request-credential.js";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

it("selects exactly one general credential and never treats refresh as one", () => {
  expect(selectRequestCredential({}, "access-token").kind).toBe("access_cookie");
  expect(selectRequestCredential({ authorization: "Bearer compact" }).kind).toBe("jwt");
  expect(selectRequestCredential({ "x-api-key": "api-key" }).kind).toBe("api_key");
  expect(() =>
    selectRequestCredential({ authorization: "Bearer compact" }, "access-token"),
  ).toThrowError(expect.objectContaining({ code: "AUTH_CREDENTIAL_CONFLICT" }));
});

it("requires same-origin double-submit and the signed access-cookie hash only for unsafe methods", () => {
  const csrf = createOpaqueSecret();
  const proof = {
    method: "POST",
    headers: {
      origin: "http://localhost:8080",
      "sec-fetch-site": "same-origin",
      "x-csrf-token": csrf,
    },
    csrfCookie: csrf,
    expectedOrigin: "http://localhost:8080",
  } as const;
  expect(() => assertAccessCookieProof(proof, digestSecretBase64url(csrf))).not.toThrow();
  expect(() => assertAccessCookieProof(proof, digestSecretBase64url(createOpaqueSecret()))).toThrow(
    expect.objectContaining({ code: "CSRF_INVALID" }),
  );
  expect(() =>
    assertAccessCookieProof({ ...proof, method: "GET", headers: {}, csrfCookie: undefined }, "x"),
  ).not.toThrow();
});

it("uses only an allowlisted immediate socket peer for forwarded auth client IP", () => {
  expect(
    resolveAuthClientIp({
      socketPeer: "203.0.113.7",
      forwardedFor: "198.51.100.8",
      trustedProxyCidrs: ["127.0.0.1/32"],
    }),
  ).toBe("203.0.113.7");
  expect(
    resolveAuthClientIp({
      socketPeer: "127.0.0.1",
      forwardedFor: "198.51.100.8",
      trustedProxyCidrs: ["127.0.0.1"],
    }),
  ).toBe("198.51.100.8");
  expect(() =>
    resolveAuthClientIp({
      socketPeer: "127.0.0.1",
      forwardedFor: "198.51.100.8, 203.0.113.7",
      trustedProxyCidrs: ["127.0.0.1/32"],
    }),
  ).toThrowError(expect.objectContaining({ code: "AUTH_DEPENDENCY_UNAVAILABLE" }));
});

it("atomically admits both login buckets and adds neither when either is full", async () => {
  let now = 0;
  const limiter = await createAuthSessionLimiter({
    mode: "local",
    redisUrl: "unused",
    clock: () => now,
  });
  const account = loginAccountBucket(TENANT_ID, "person@example.invalid");
  for (let index = 0; index < 5; index += 1) {
    expect((await limiter.admitLogin(account, `192.0.2.${index + 1}`)).allowed).toBe(true);
  }
  now = 899_000;
  expect(
    (
      await limiter.admitLogin(
        loginAccountBucket(TENANT_ID, "target-ip-seed@example.invalid"),
        "198.51.100.1",
      )
    ).allowed,
  ).toBe(true);
  const denial = await limiter.admitLogin(account, "198.51.100.1");
  expect(denial).toEqual({ allowed: false, retryAfterSeconds: 1 });
  const admitted = [];
  for (let index = 0; index < 19; index += 1) {
    admitted.push(
      await limiter.admitLogin(
        loginAccountBucket(TENANT_ID, `other-${index}@example.invalid`),
        "198.51.100.1",
      ),
    );
  }
  expect(admitted.every((decision) => decision.allowed)).toBe(true);
  expect(
    (
      await limiter.admitLogin(
        loginAccountBucket(TENANT_ID, "last@example.invalid"),
        "198.51.100.1",
      )
    ).allowed,
  ).toBe(false);
  await limiter.close();
});

it("performs one bounded Argon verification for unknown and malformed credential candidates", async () => {
  const baseExecutor = createArgonExecutor({ concurrency: 2, queueLimit: 32 });
  const password = Array.from({ length: 20 }, (_, index) => String.fromCharCode(65 + index)).join(
    "",
  );
  const dummyPasswordHash = await hashPassword(password, baseExecutor);
  let verifyCount = 0;
  const countingExecutor: ArgonExecutor = {
    run: async (operation) => {
      verifyCount += 1;
      return operation();
    },
    snapshot: () => ({ active: 0, queued: 0, closed: false }),
    close: () => undefined,
  };
  const limiter = await createAuthSessionLimiter({ mode: "local", redisUrl: "unused" });
  let malformed = false;
  const service = createAuthSessionService({
    loginRepository: {
      findCandidate: async () =>
        malformed
          ? {
              tenantId: TENANT_ID,
              userId: "22222222-2222-4222-8222-222222222222",
              role: "finops_analyst",
              tenantActive: true,
              userActive: true,
              passwordHash: "malformed",
            }
          : null,
      issue: async () => ({ kind: "invalid" }),
    },
    refreshRepository: {
      findFamilyId: async () => null,
      rotate: async () => ({ kind: "invalid" }),
    },
    logoutRepository: {
      findFamilyId: async () => null,
      logout: async () => ({ kind: "complete" }),
    },
    limiter,
    argonExecutor: countingExecutor,
    dummyPasswordHash,
    accessLifetimeSeconds: 900,
    sign: () => {
      throw authError("AUTH_DEPENDENCY_UNAVAILABLE");
    },
  });
  const attempt = () =>
    service.login({
      tenantId: TENANT_ID,
      email: "person@example.invalid",
      password,
      clientIp: "127.0.0.1",
      requestId: "request-id",
    });
  await expect(attempt()).rejects.toMatchObject({ code: "AUTH_INVALID" });
  malformed = true;
  await expect(attempt()).rejects.toMatchObject({ code: "AUTH_INVALID" });
  expect(verifyCount).toBe(2);
  baseExecutor.close();
  await limiter.close();
});
