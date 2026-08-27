import { createPublicKey } from "node:crypto";
import { afterEach, expect, it } from "vitest";

import { buildApp } from "../../apps/api/app.js";
import { createAuthRepository } from "../../core/tenant/auth-repository.js";
import {
  createLocalProtectedUsersLimiter,
  type ProtectedUsersLimiter,
} from "../../core/tenant/protected-users-limiter.js";
import { createUsersRepository } from "../../core/tenant/users-repository.js";
import { createUsersService } from "../../core/tenant/users-service.js";
import { dropIsolatedDatabase } from "./helpers/postgres-database.js";
import {
  closeUsersHarness,
  createUsersHarness,
  usersAuthorization,
  type UsersHarness,
} from "./helpers/users-app.js";

let harness: UsersHarness | undefined;

afterEach(async () => {
  const current = harness;
  harness = undefined;
  await closeUsersHarness(current);
  await dropIsolatedDatabase(current?.database);
});

it("returns Retry-After on the local 61st list request", async () => {
  harness = await createUsersHarness("ccpo_users_get_limit");
  for (let count = 0; count < 60; count += 1) {
    const admitted = await harness.app.inject({
      method: "GET",
      url: "/api/users?limit=1",
      headers: usersAuthorization(harness),
    });
    expect(admitted.statusCode, String(count)).toBe(200);
  }
  const denied = await harness.app.inject({
    method: "GET",
    url: "/api/users?limit=1",
    headers: usersAuthorization(harness),
  });
  expect(denied.statusCode).toBe(429);
  expectRetryAfterSeconds(denied.headers["retry-after"]);
  expect(denied.json().error.code).toBe("RATE_LIMITED");
});

it("returns the local 31st create before repository mutation", async () => {
  harness = await createUsersHarness("ccpo_users_post_limit");
  const before = await countUsers();
  for (let count = 0; count < 30; count += 1) {
    const admitted = await harness.app.inject({
      method: "POST",
      url: "/api/users",
      headers: { "content-type": "application/json", ...usersAuthorization(harness) },
      payload: {
        email: `limited-${count}@example.invalid`,
        name: `Limited ${count}`,
        role: "finops_analyst",
      },
    });
    expect(admitted.statusCode, String(count)).toBe(201);
  }
  const denied = await harness.app.inject({
    method: "POST",
    url: "/api/users",
    headers: { "content-type": "application/json", ...usersAuthorization(harness) },
    payload: {
      email: "must-not-mutate@example.invalid",
      name: "Must Not Mutate",
      role: "finops_analyst",
    },
  });

  expect(denied.statusCode).toBe(429);
  const retryAfter = expectRetryAfterSeconds(denied.headers["retry-after"]);
  const deniedAgain = await harness.app.inject({
    method: "POST",
    url: "/api/users",
    headers: { "content-type": "application/json", ...usersAuthorization(harness) },
    payload: {
      email: "still-must-not-mutate@example.invalid",
      name: "Still Must Not Mutate",
      role: "finops_analyst",
    },
  });
  expect(deniedAgain.statusCode).toBe(429);
  expect(expectRetryAfterSeconds(deniedAgain.headers["retry-after"])).toBeLessThanOrEqual(
    retryAfter,
  );
  expect(await countUsers()).toBe(before + 30);
  const absent = await harness.pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM users WHERE email IN ('must-not-mutate@example.invalid', 'still-must-not-mutate@example.invalid')",
  );
  expect(absent.rows[0]!.count).toBe(0);
});

it("fails closed on limiter dependency loss before mutation", async () => {
  harness = await createUsersHarness("ccpo_users_limiter_loss");
  const limiter = createLocalProtectedUsersLimiter();
  await limiter.close?.();
  const app = limitedApp(limiter);
  const before = await countUsers();
  const response = await app.inject({
    method: "POST",
    url: "/api/users",
    headers: { "content-type": "application/json", ...usersAuthorization(harness) },
    payload: {
      email: "dependency-loss@example.invalid",
      name: "Dependency Loss",
      role: "finops_analyst",
    },
  });
  await app.close();

  expect(response.statusCode).toBe(503);
  expect(response.json().error.code).toBe("PROTECTED_RATE_LIMIT_DEPENDENCY_UNAVAILABLE");
  expect(await countUsers()).toBe(before);
});

function limitedApp(limiter: ProtectedUsersLimiter) {
  const logger = safeLogger();
  return buildApp({
    logger,
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
    users: {
      limiter,
      service: createUsersService(createUsersRepository(harness!.pool), logger),
    },
  });
}

async function countUsers(): Promise<number> {
  const result = await harness!.pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM users WHERE tenant_id = $1",
    [harness!.tenantA],
  );
  return result.rows[0]!.count;
}

function expectRetryAfterSeconds(header: string | undefined): number {
  expect(header).toMatch(/^\d+$/u);
  const seconds = Number(header);
  expect(Number.isInteger(seconds)).toBe(true);
  expect(seconds).toBeGreaterThanOrEqual(1);
  expect(seconds).toBeLessThanOrEqual(60);
  return seconds;
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
