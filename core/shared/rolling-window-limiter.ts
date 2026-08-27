import { randomUUID } from "node:crypto";

import { createClient, type RedisClientType } from "redis";

export interface RollingWindowDecision {
  allowed: boolean;
  retryAfterSeconds?: number;
}

export interface RollingWindowLimiter {
  admit(key: string, limit: number, windowMs: number): Promise<RollingWindowDecision>;
  close(): Promise<void>;
}

export interface LocalRollingWindowOptions {
  clock?: () => number;
  unavailable: () => Error;
}

export interface RedisRollingWindowOptions {
  url: string;
  keyPrefix: string;
  unavailable: () => Error;
}

const REDIS_SCRIPT = `
local now_parts = redis.call('TIME')
local now = (tonumber(now_parts[1]) * 1000) + math.floor(tonumber(now_parts[2]) / 1000)
local cutoff = now - tonumber(ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', cutoff)
local count = redis.call('ZCARD', KEYS[1])
if count >= tonumber(ARGV[2]) then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  local retry = math.max(1, math.ceil((tonumber(oldest[2]) + tonumber(ARGV[1]) - now) / 1000))
  return {0, retry}
end
redis.call('ZADD', KEYS[1], now, ARGV[3])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[1]) * 2)
return {1, 0}
`;

export function createLocalRollingWindowLimiter(
  options: LocalRollingWindowOptions,
): RollingWindowLimiter {
  const clock = options.clock ?? Date.now;
  const buckets = new Map<string, number[]>();
  let closed = false;
  return {
    async admit(key, limit, windowMs) {
      if (closed) throw options.unavailable();
      const now = clock();
      const admitted = (buckets.get(key) ?? []).filter((value) => value > now - windowMs);
      if (admitted.length >= limit) {
        buckets.set(key, admitted);
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((admitted[0]! + windowMs - now) / 1000)),
        };
      }
      admitted.push(now);
      buckets.set(key, admitted);
      return { allowed: true };
    },
    async close() {
      closed = true;
      buckets.clear();
    },
  };
}

export async function createRedisRollingWindowLimiter(
  options: RedisRollingWindowOptions,
): Promise<RollingWindowLimiter> {
  const client = createClient({ url: options.url });
  let dependencyFailed = false;
  client.on("error", () => {
    dependencyFailed = true;
  });
  try {
    await client.connect();
    await client.ping();
    if (dependencyFailed) throw options.unavailable();
  } catch {
    client.destroy();
    throw options.unavailable();
  }
  return redisRollingWindow(client, options, () => dependencyFailed);
}

function redisRollingWindow(
  client: RedisClientType,
  options: RedisRollingWindowOptions,
  dependencyFailed: () => boolean,
): RollingWindowLimiter {
  let closed = false;
  return {
    async admit(key, limit, windowMs) {
      if (closed || dependencyFailed() || !client.isReady) throw options.unavailable();
      try {
        const value = await client.eval(REDIS_SCRIPT, {
          keys: [`${options.keyPrefix}${key}`],
          arguments: [String(windowMs), String(limit), randomUUID()],
        });
        return parseDecision(value, options.unavailable);
      } catch {
        throw options.unavailable();
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      if (client.isOpen) await client.close();
    },
  };
}

function parseDecision(value: unknown, unavailable: () => Error): RollingWindowDecision {
  if (!Array.isArray(value) || value.length !== 2) throw unavailable();
  const allowed = Number(value[0]);
  const retry = Number(value[1]);
  if ((allowed !== 0 && allowed !== 1) || !Number.isSafeInteger(retry) || retry < 0) {
    throw unavailable();
  }
  return allowed === 1
    ? { allowed: true }
    : { allowed: false, retryAfterSeconds: Math.max(1, retry) };
}
