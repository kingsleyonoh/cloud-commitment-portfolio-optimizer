import { createHash } from "node:crypto";

import ipaddr from "ipaddr.js";

import { AppError } from "../shared/errors.js";
import { createManagedCache } from "../shared/lifecycle.js";
import {
  createLocalRollingWindowLimiter,
  createRedisRollingWindowLimiter,
  type RollingWindowDecision,
} from "../shared/rolling-window-limiter.js";

export const REGISTRATION_LIMIT = 5;
export const REGISTRATION_WINDOW_MS = 60_000;

export type RegistrationLimitDecision = RollingWindowDecision;

export interface RegistrationLimiter {
  readonly mode: "local" | "redis" | "trusted_edge";
  admit(clientIp: string): Promise<RegistrationLimitDecision>;
  close?(): Promise<void>;
}

export interface LocalLimiterOptions {
  clock?: () => number;
}

export interface RedisLimiterOptions {
  url: string;
  keyPrefix?: string;
}

export interface RegistrationLimiterConfig {
  mode: RegistrationLimiter["mode"];
  redisUrl: string;
}

export function canonicalizeClientIp(input: string): string {
  try {
    return ipaddr.process(input).toString().toLowerCase();
  } catch {
    throw unavailable();
  }
}

export function createLocalRegistrationLimiter(
  options: LocalLimiterOptions = {},
): RegistrationLimiter {
  const rolling = createLocalRollingWindowLimiter({
    ...(options.clock ? { clock: options.clock } : {}),
    unavailable,
  });
  return registrationLimiter("local", rolling.admit, rolling.close);
}

export async function createRedisRegistrationLimiter(
  options: RedisLimiterOptions,
): Promise<RegistrationLimiter> {
  const rolling = await createRedisRollingWindowLimiter({
    url: options.url,
    keyPrefix: options.keyPrefix ?? "ccpo:registration-limit:v1:",
    unavailable,
  });
  return registrationLimiter("redis", rolling.admit, rolling.close);
}

export function createTrustedEdgeRegistrationLimiter(): RegistrationLimiter {
  return {
    mode: "trusted_edge",
    async admit() {
      return { allowed: true };
    },
  };
}

function registrationLimiter(
  mode: "local" | "redis",
  admit: (key: string, limit: number, windowMs: number) => Promise<RollingWindowDecision>,
  close: () => Promise<void>,
): RegistrationLimiter {
  return {
    mode,
    async admit(clientIp) {
      return admit(
        bucketDigest(canonicalizeClientIp(clientIp)),
        REGISTRATION_LIMIT,
        REGISTRATION_WINDOW_MS,
      );
    },
    close,
  };
}

function bucketDigest(clientIp: string): string {
  return createHash("sha256").update(clientIp, "utf8").digest("hex");
}

function unavailable(): AppError {
  return new AppError({
    code: "REGISTRATION_DEPENDENCY_UNAVAILABLE",
    message: "Registration is temporarily unavailable.",
    statusCode: 503,
  });
}

let configured: RegistrationLimiterConfig | undefined;
const limiterCache = createManagedCache(
  async () => {
    if (!configured) throw unavailable();
    if (configured.mode === "local") return createLocalRegistrationLimiter();
    if (configured.mode === "trusted_edge") return createTrustedEdgeRegistrationLimiter();
    return createRedisRegistrationLimiter({ url: configured.redisUrl });
  },
  async (limiter) => limiter.close?.(),
);

export function getRegistrationLimiter(
  config: RegistrationLimiterConfig,
): Promise<RegistrationLimiter> {
  configured ??= { ...config };
  return limiterCache.get();
}

export async function closeRegistrationLimiter(): Promise<void> {
  try {
    await limiterCache.close();
  } finally {
    configured = undefined;
  }
}
