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
  if (!redisUrl) throw new Error("TEST_REDIS_URL is required for the real Redis 7 rotation test.");
  return redisUrl;
}

function context() {
  return createUserRequestContext({
    tenantId: "11111111-1111-4111-8111-111111111111",
    actorUserId: "22222222-2222-4222-8222-222222222222",
    role: "tenant_admin",
    requestId: "rotation-limit",
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

it("atomically shares the exact five-rotation window without reversible bucket material", async () => {
  const url = requireRedisUrl();
  const inspector = createClient({ url });
  await inspector.connect();
  clients.push(inspector);
  expect(await inspector.info("server")).toMatch(/redis_version:7\./u);
  const prefix = `ccpo:test:rotation:${randomBytes(8).toString("hex")}:`;
  prefixes.push(prefix);
  const first = await createRedisProtectedUsersLimiter({ url, keyPrefix: prefix });
  const second = await createRedisProtectedUsersLimiter({ url, keyPrefix: prefix });
  limiters.push(first, second);

  const outcomes = await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      (index % 2 === 0 ? first : second).admit(context(), "POST", "/api/api-keys/rotate"),
    ),
  );

  expect(outcomes.filter((outcome) => outcome.allowed)).toHaveLength(5);
  expect(outcomes.filter((outcome) => !outcome.allowed)).toHaveLength(7);
  const keys = await inspector.keys(`${prefix}*`);
  expect(keys).toHaveLength(1);
  expect(keys[0]).not.toContain(context().tenantId);
  expect(keys[0]).not.toContain(context().actorUserId);
});
