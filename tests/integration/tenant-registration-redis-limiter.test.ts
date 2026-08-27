import { randomBytes } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { createClient, type RedisClientType } from "redis";
import {
  createRedisRegistrationLimiter,
  type RegistrationLimiter,
} from "../../core/tenant/registration-limiter.js";

const redisUrl = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL;
let clients: RedisClientType[] = [];
const limiters: RegistrationLimiter[] = [];
let prefixes: string[] = [];

function requireRedisUrl(): string {
  if (!redisUrl) throw new Error("TEST_REDIS_URL is required for the real Redis 7 limiter test.");
  return redisUrl;
}

function uniquePrefix(): string {
  const prefix = `ccpo:test:registration:${randomBytes(8).toString("hex")}:`;
  prefixes.push(prefix);
  return prefix;
}

async function cleanupPrefix(client: RedisClientType, prefix: string): Promise<void> {
  const keys = await client.keys(`${prefix}*`);
  await Promise.all(keys.map((key) => client.del(key)));
}

afterEach(async () => {
  for (const limiter of limiters.splice(0)) await limiter.close?.().catch(() => undefined);
  for (const client of clients) {
    for (const prefix of prefixes) await cleanupPrefix(client, prefix).catch(() => undefined);
    await client.close().catch(() => undefined);
  }
  clients = [];
  prefixes = [];
});

it("enforces one rolling window atomically across instances and stores no raw IP", async () => {
  const url = requireRedisUrl();
  const inspector = createClient({ url });
  await inspector.connect();
  clients.push(inspector);
  const info = await inspector.info("server");
  expect(info).toMatch(/redis_version:7\./u);

  const keyPrefix = uniquePrefix();
  const first = await createRedisRegistrationLimiter({ url, keyPrefix });
  const second = await createRedisRegistrationLimiter({ url, keyPrefix });
  limiters.push(first, second);
  const ip = "2001:db8::42";
  const outcomes = await Promise.all(
    Array.from({ length: 24 }, (_, index) => (index % 2 === 0 ? first : second).admit(ip)),
  );

  expect(outcomes.filter(({ allowed }) => allowed)).toHaveLength(5);
  expect(outcomes.filter(({ allowed }) => !allowed)).toHaveLength(19);
  expect(
    outcomes
      .filter((outcome) => !outcome.allowed)
      .every((outcome) => (outcome.retryAfterSeconds ?? 0) >= 1),
  ).toBe(true);

  const keys = await inspector.keys(`${keyPrefix}*`);
  expect(keys).toHaveLength(1);
  expect(keys[0]).not.toContain(ip);
});

it("fails closed when the shared limiter becomes unavailable", async () => {
  const limiter = await createRedisRegistrationLimiter({
    url: requireRedisUrl(),
    keyPrefix: uniquePrefix(),
  });
  limiters.push(limiter);
  await limiter.close?.();

  await expect(limiter.admit("192.0.2.1")).rejects.toMatchObject({
    code: "REGISTRATION_DEPENDENCY_UNAVAILABLE",
    statusCode: 503,
  });
});
