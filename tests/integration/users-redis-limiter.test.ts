import { randomBytes } from "node:crypto";
import { createClient, type RedisClientType } from "redis";
import { afterEach, expect, it } from "vitest";

import {
  createRedisProtectedUsersLimiter,
  type ProtectedUsersLimiter,
} from "../../core/tenant/protected-users-limiter.js";
import { createUserRequestContext } from "../../core/tenant/request-context.js";

const redisUrl = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL;
const clients: RedisClientType[] = [];
const limiters: ProtectedUsersLimiter[] = [];
const prefixes: string[] = [];

function requireRedisUrl(): string {
  if (!redisUrl)
    throw new Error("TEST_REDIS_URL is required for the real Redis 7 users limiter test.");
  return redisUrl;
}

function context() {
  return createUserRequestContext({
    tenantId: "11111111-1111-4111-8111-111111111111",
    actorUserId: "22222222-2222-4222-8222-222222222222",
    role: "tenant_admin",
    requestId: "redis-limit-request",
  });
}

afterEach(async () => {
  for (const limiter of limiters.splice(0)) await limiter.close?.().catch(() => undefined);
  for (const client of clients.splice(0)) {
    for (const prefix of prefixes.splice(0)) {
      const keys = await client.keys(`${prefix}*`).catch(() => []);
      await Promise.all(keys.map((key) => client.del(key))).catch(() => undefined);
    }
    await client.close().catch(() => undefined);
  }
});

it("enforces the GET window atomically across Redis 7 instances without raw context keys", async () => {
  const url = requireRedisUrl();
  const inspector = createClient({ url });
  await inspector.connect();
  clients.push(inspector);
  expect(await inspector.info("server")).toMatch(/redis_version:7\./u);
  const prefix = `ccpo:test:users:${randomBytes(8).toString("hex")}:`;
  prefixes.push(prefix);
  const first = await createRedisProtectedUsersLimiter({ url, keyPrefix: prefix });
  const second = await createRedisProtectedUsersLimiter({ url, keyPrefix: prefix });
  limiters.push(first, second);
  const outcomes = await Promise.all(
    Array.from({ length: 96 }, (_, index) =>
      (index % 2 === 0 ? first : second).admit(context(), "GET", "/api/users"),
    ),
  );

  expect(outcomes.filter(({ allowed }) => allowed)).toHaveLength(60);
  expect(outcomes.filter(({ allowed }) => !allowed)).toHaveLength(36);
  expect(
    outcomes.filter(({ allowed }) => !allowed).every((item) => item.retryAfterSeconds! >= 1),
  ).toBe(true);
  const keys = await inspector.keys(`${prefix}*`);
  expect(keys).toHaveLength(1);
  expect(keys[0]).not.toContain(context().tenantId);
  expect(keys[0]).not.toContain(context().actorUserId);
});

it("shares the five-attempt password target window without reversible bucket identifiers", async () => {
  const url = requireRedisUrl();
  const inspector = createClient({ url });
  await inspector.connect();
  clients.push(inspector);
  const prefix = `ccpo:test:password-users:${randomBytes(8).toString("hex")}:`;
  prefixes.push(prefix);
  const first = await createRedisProtectedUsersLimiter({ url, keyPrefix: prefix });
  const second = await createRedisProtectedUsersLimiter({ url, keyPrefix: prefix });
  limiters.push(first, second);
  const target = "33333333-3333-4333-8333-333333333333";
  const outcomes = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      (index % 2 === 0 ? first : second).admit(
        context(),
        "PUT",
        "/api/users/{id}/credentials/password",
        target,
      ),
    ),
  );

  expect(outcomes.filter(({ allowed }) => allowed)).toHaveLength(5);
  expect(outcomes.filter(({ allowed }) => !allowed)).toHaveLength(3);
  expect(
    await first.admit(
      context(),
      "PUT",
      "/api/users/{id}/credentials/password",
      "44444444-4444-4444-8444-444444444444",
    ),
  ).toEqual({ allowed: true });
  const keys = await inspector.keys(`${prefix}*`);
  expect(keys).toHaveLength(2);
  expect(keys.every((key) => !key.includes(context().tenantId) && !key.includes(target))).toBe(
    true,
  );
});

it("fails closed after the shared Redis limiter is unavailable", async () => {
  const limiter = await createRedisProtectedUsersLimiter({
    url: requireRedisUrl(),
    keyPrefix: `ccpo:test:users:${randomBytes(8).toString("hex")}:`,
  });
  limiters.push(limiter);
  await limiter.close?.();

  await expect(limiter.admit(context(), "POST", "/api/users")).rejects.toMatchObject({
    code: "PROTECTED_RATE_LIMIT_DEPENDENCY_UNAVAILABLE",
    statusCode: 503,
  });
});
