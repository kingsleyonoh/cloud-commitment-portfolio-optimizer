import { randomBytes, randomUUID } from "node:crypto";

import { createClient, type RedisClientType } from "redis";
import { afterEach, expect, it } from "vitest";

import {
  createAuthSessionLimiter,
  loginAccountBucket,
  type AuthSessionLimiter,
} from "../../core/tenant/auth-session-limiter.js";

const redisUrl = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL;
const limiters: AuthSessionLimiter[] = [];
const clients: RedisClientType[] = [];
const prefixes: string[] = [];

function requireRedisUrl(): string {
  if (!redisUrl) throw new Error("TEST_REDIS_URL is required for the real Redis 7 auth test.");
  return redisUrl;
}

function prefix(): string {
  const value = `ccpo:test:auth:${randomBytes(8).toString("hex")}:`;
  prefixes.push(value);
  return value;
}

afterEach(async () => {
  for (const limiter of limiters.splice(0)) await limiter.close().catch(() => undefined);
  const cleanupClients = clients.splice(0);
  if (prefixes.length > 0 && cleanupClients.length === 0) {
    const cleanupClient = createClient({ url: requireRedisUrl() });
    await cleanupClient.connect();
    cleanupClients.push(cleanupClient);
  }
  for (const client of cleanupClients) {
    for (const keyPrefix of prefixes) {
      const keys = await client.keys(`${keyPrefix}*`);
      await Promise.all(keys.map((key) => client.del(key)));
    }
    await client.close().catch(() => undefined);
  }
  prefixes.length = 0;
});

it("atomically enforces dual login buckets across Redis-backed app instances", async () => {
  const url = requireRedisUrl();
  const keyPrefix = prefix();
  const first = await createAuthSessionLimiter({ mode: "redis", redisUrl: url, keyPrefix });
  const second = await createAuthSessionLimiter({ mode: "redis", redisUrl: url, keyPrefix });
  limiters.push(first, second);
  const account = loginAccountBucket(
    "11111111-1111-4111-8111-111111111111",
    "person@example.invalid",
  );
  const decisions = await Promise.all(
    Array.from({ length: 24 }, (_, index) =>
      (index % 2 === 0 ? first : second).admitLogin(account, "192.0.2.1"),
    ),
  );

  expect(decisions.filter((decision) => decision.allowed)).toHaveLength(5);
  expect(decisions.filter((decision) => !decision.allowed)).toHaveLength(19);
  expect(
    decisions
      .filter((decision) => !decision.allowed)
      .every((decision) => (decision.retryAfterSeconds ?? 0) >= 1),
  ).toBe(true);
});

it("shares the independent IP and confirmed-family refresh bounds across instances", async () => {
  const url = requireRedisUrl();
  const keyPrefix = prefix();
  const first = await createAuthSessionLimiter({ mode: "redis", redisUrl: url, keyPrefix });
  const second = await createAuthSessionLimiter({ mode: "redis", redisUrl: url, keyPrefix });
  limiters.push(first, second);
  const familyId = randomUUID();
  const family = await Promise.all(
    Array.from({ length: 16 }, (_, index) =>
      (index % 2 === 0 ? first : second).admitRefreshFamily(familyId),
    ),
  );
  const ip = await Promise.all(
    Array.from({ length: 70 }, (_, index) =>
      (index % 2 === 0 ? first : second).admitRefreshIp("2001:db8::42"),
    ),
  );

  expect(family.filter((decision) => decision.allowed)).toHaveLength(10);
  expect(ip.filter((decision) => decision.allowed)).toHaveLength(60);
});

it("stores only domain-separated digests and fails closed after Redis loss", async () => {
  const url = requireRedisUrl();
  const keyPrefix = prefix();
  const inspector = createClient({ url });
  await inspector.connect();
  clients.push(inspector);
  expect(await inspector.info("server")).toMatch(/redis_version:7\./u);
  const limiter = await createAuthSessionLimiter({ mode: "redis", redisUrl: url, keyPrefix });
  limiters.push(limiter);
  const email = "private-marker@example.invalid";
  const ip = "198.51.100.44";
  await limiter.admitLogin(loginAccountBucket("11111111-1111-4111-8111-111111111111", email), ip);
  const keys = await inspector.keys(`${keyPrefix}*`);
  expect(keys.length).toBe(2);
  expect(keys.every((key) => !key.includes(email) && !key.includes(ip))).toBe(true);
  await limiter.close();
  await expect(limiter.admitRefreshIp(ip)).rejects.toMatchObject({
    code: "AUTH_DEPENDENCY_UNAVAILABLE",
    statusCode: 503,
  });
});
