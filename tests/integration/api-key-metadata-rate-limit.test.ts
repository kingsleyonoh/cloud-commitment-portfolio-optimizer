import { createPublicKey } from "node:crypto";

import { afterEach, expect, it } from "vitest";

import { buildApp } from "../../apps/api/app.js";
import { createApiKeyMetadataRepository } from "../../core/tenant/api-key-metadata-repository.js";
import { createApiKeyMetadataService } from "../../core/tenant/api-key-metadata-service.js";
import { createAuthRepository } from "../../core/tenant/auth-repository.js";
import {
  createLocalProtectedUsersLimiter,
  type ProtectedUsersLimiter,
} from "../../core/tenant/protected-users-limiter.js";
import { dropIsolatedDatabase } from "./helpers/postgres-database.js";
import {
  apiKeyMetadataAuthorization,
  closeApiKeyMetadataHarness,
  createApiKeyMetadataHarness,
  type ApiKeyMetadataHarness,
} from "./helpers/api-key-metadata-app.js";

let harness: ApiKeyMetadataHarness | undefined;

afterEach(async () => {
  const current = harness;
  harness = undefined;
  await closeApiKeyMetadataHarness(current);
  await dropIsolatedDatabase(current?.database);
});

it("returns Retry-After on the local 61st list request and performs only 60 repository calls", async () => {
  harness = await createApiKeyMetadataHarness("ccpo_api_key_metadata_limit");
  const limiter = createLocalProtectedUsersLimiter({ clock: () => 1_000 });
  let calls = 0;
  const repository = createApiKeyMetadataRepository(harness.pool);
  const app = isolatedApp(limiter, async (input) => {
    calls += 1;
    return repository.list(input);
  });
  for (let count = 0; count < 60; count += 1) {
    const response = await app.inject({
      method: "GET",
      url: "/api/api-keys?limit=1",
      headers: apiKeyMetadataAuthorization(harness),
    });
    expect(response.statusCode, String(count)).toBe(200);
  }
  const denied = await app.inject({
    method: "GET",
    url: "/api/api-keys?limit=1",
    headers: apiKeyMetadataAuthorization(harness),
  });
  await app.close();

  expect(denied.statusCode).toBe(429);
  expect(denied.headers["retry-after"]).toBe("60");
  expect(denied.json()).toEqual({
    error: { code: "RATE_LIMITED", message: "Too many API-key metadata requests.", details: [] },
  });
  expect(calls).toBe(60);
});

it("does no limiter or repository listing work for denied actors", async () => {
  harness = await createApiKeyMetadataHarness("ccpo_api_key_metadata_denied");
  let limiterCalls = 0;
  let repositoryCalls = 0;
  const limiter: ProtectedUsersLimiter = {
    mode: "local",
    admit: async () => {
      limiterCalls += 1;
      return { allowed: true };
    },
  };
  const app = isolatedApp(limiter, async () => {
    repositoryCalls += 1;
    return [];
  });
  const deniedJwt = await app.inject({
    method: "GET",
    url: "/api/api-keys",
    headers: apiKeyMetadataAuthorization(harness, "finops_analyst", "finops_analyst"),
  });
  const deniedApiKey = await app.inject({
    method: "GET",
    url: "/api/api-keys",
    headers: { "x-api-key": harness.analystApiKey },
  });
  await app.close();

  expect([deniedJwt.statusCode, deniedApiKey.statusCode]).toEqual([403, 403]);
  expect(limiterCalls).toBe(0);
  expect(repositoryCalls).toBe(0);
});

it("fails closed on limiter dependency loss before the repository", async () => {
  harness = await createApiKeyMetadataHarness("ccpo_api_key_metadata_limit_loss");
  const limiter = createLocalProtectedUsersLimiter();
  await limiter.close?.();
  let calls = 0;
  const app = isolatedApp(limiter, async () => {
    calls += 1;
    return [];
  });
  const response = await app.inject({
    method: "GET",
    url: "/api/api-keys",
    headers: apiKeyMetadataAuthorization(harness),
  });
  await app.close();

  expect(response.statusCode).toBe(503);
  expect(response.json().error.code).toBe("PROTECTED_RATE_LIMIT_DEPENDENCY_UNAVAILABLE");
  expect(calls).toBe(0);
});

function isolatedApp(
  limiter: ProtectedUsersLimiter,
  list: ReturnType<typeof createApiKeyMetadataRepository>["list"],
) {
  return buildApp({
    logger: safeLogger(),
    databaseProbe: async () => ({ ready: true }),
    databaseTimeoutMs: 100,
    authentication: {
      repository: createAuthRepository(harness!.pool),
      jwtPublicKey: createPublicKey(harness!.privateKey),
      jwtPolicy: {
        issuer: "ccpo",
        audience: "ccpo-ui",
        maxLifetimeSeconds: 900,
        clockToleranceSeconds: 30,
      },
    },
    apiKeys: {
      limiter,
      service: createApiKeyMetadataService({ list }),
    },
  });
}

function safeLogger() {
  const logger = {
    debug: async () => undefined,
    info: async () => undefined,
    warn: async () => undefined,
    error: async () => undefined,
    child: () => logger,
    flush: async () => undefined,
    close: async () => undefined,
  };
  return logger;
}
