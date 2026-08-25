import { createHash } from "node:crypto";

import { AppError } from "../shared/errors.js";
import { createManagedCache } from "../shared/lifecycle.js";
import {
  createLocalRollingWindowLimiter,
  createRedisRollingWindowLimiter,
  type RollingWindowDecision,
} from "../shared/rolling-window-limiter.js";
import type { RequestContext } from "./request-context.js";

export const USERS_LIMIT_WINDOW_MS = 60_000;
export const USERS_LIST_LIMIT = 60;
export const USERS_MUTATION_LIMIT = 30;
export const API_KEY_ROTATION_LIMIT = 5;
export const PASSWORD_PROVISION_LIMIT = 5;
export const CLOUD_ACCOUNTS_LIST_LIMIT = 120;
export const CLOUD_ACCOUNTS_MUTATION_LIMIT = 60;
export const CLOUD_ACCOUNTS_DEACTIVATE_LIMIT = 20;
export const IMPORTS_LIST_LIMIT = 120;
export const IMPORTS_CREATE_LIMIT = 20;

export type ProtectedUsersMethod = "GET" | "POST" | "PATCH" | "PUT";
export type ProtectedUsersRoute =
  | "/api/users"
  | "/api/users/{id}"
  | "/api/users/{id}/credentials/password"
  | "/api/api-keys"
  | "/api/api-keys/rotate"
  | "/api/cloud-accounts"
  | "/api/cloud-accounts/{id}"
  | "/api/cloud-accounts/{id}/deactivate"
  | "/api/imports"
  | "/api/imports/{id}";
export type ProtectedUsersLimitDecision = RollingWindowDecision;

export interface ProtectedUsersLimiter {
  readonly mode: "local" | "redis" | "trusted_edge";
  admit(
    context: RequestContext,
    method: ProtectedUsersMethod,
    route: ProtectedUsersRoute,
    targetId?: string,
  ): Promise<ProtectedUsersLimitDecision>;
  close?(): Promise<void>;
}

export interface LocalProtectedUsersLimiterOptions {
  clock?: () => number;
}

export interface RedisProtectedUsersLimiterOptions {
  url: string;
  keyPrefix?: string;
}

export interface ProtectedUsersLimiterConfig {
  mode: ProtectedUsersLimiter["mode"];
  redisUrl: string;
}

export function protectedUsersBucketDigest(
  context: RequestContext,
  method: ProtectedUsersMethod,
  route: ProtectedUsersRoute,
  targetId?: string,
): string {
  const actorId = context.actorUserId ?? context.apiKeyId;
  const digest = createHash("sha256")
    .update("protected-route-limit:v2\0", "utf8")
    .update(context.tenantId, "utf8")
    .update("\0", "utf8")
    .update(actorId ?? "anonymous", "utf8")
    .update("\0", "utf8")
    .update(route, "utf8")
    .update("\0", "utf8")
    .update(method, "utf8");
  if (targetId) digest.update("\0target\0", "utf8").update(targetId, "utf8");
  return digest.digest("hex");
}

export function createLocalProtectedUsersLimiter(
  options: LocalProtectedUsersLimiterOptions = {},
): ProtectedUsersLimiter {
  const rolling = createLocalRollingWindowLimiter({
    ...(options.clock ? { clock: options.clock } : {}),
    unavailable,
  });
  return protectedLimiter("local", rolling.admit, rolling.close);
}

export async function createRedisProtectedUsersLimiter(
  options: RedisProtectedUsersLimiterOptions,
): Promise<ProtectedUsersLimiter> {
  const rolling = await createRedisRollingWindowLimiter({
    url: options.url,
    keyPrefix: options.keyPrefix ?? "ccpo:protected-route-limit:v2:",
    unavailable,
  });
  return protectedLimiter("redis", rolling.admit, rolling.close);
}

export function createTrustedEdgeProtectedUsersLimiter(): ProtectedUsersLimiter {
  return {
    mode: "trusted_edge",
    async admit() {
      return { allowed: true };
    },
  };
}

function protectedLimiter(
  mode: "local" | "redis",
  admit: (key: string, limit: number, windowMs: number) => Promise<RollingWindowDecision>,
  close: () => Promise<void>,
): ProtectedUsersLimiter {
  return {
    mode,
    async admit(context, method, route, targetId) {
      return admit(
        protectedUsersBucketDigest(context, method, route, targetId),
        protectedRouteLimit(method, route),
        USERS_LIMIT_WINDOW_MS,
      );
    },
    close,
  };
}

function protectedRouteLimit(method: ProtectedUsersMethod, route: ProtectedUsersRoute): number {
  if (method === "POST" && route === "/api/api-keys/rotate") return API_KEY_ROTATION_LIMIT;
  if (method === "POST" && route === "/api/cloud-accounts/{id}/deactivate") {
    return CLOUD_ACCOUNTS_DEACTIVATE_LIMIT;
  }
  if (route.startsWith("/api/cloud-accounts")) {
    return method === "GET" ? CLOUD_ACCOUNTS_LIST_LIMIT : CLOUD_ACCOUNTS_MUTATION_LIMIT;
  }
  if (route.startsWith("/api/imports")) {
    return method === "GET" ? IMPORTS_LIST_LIMIT : IMPORTS_CREATE_LIMIT;
  }
  if (method === "PUT" && route === "/api/users/{id}/credentials/password") {
    return PASSWORD_PROVISION_LIMIT;
  }
  return method === "GET" ? USERS_LIST_LIMIT : USERS_MUTATION_LIMIT;
}

function unavailable(): AppError {
  return new AppError({
    code: "PROTECTED_RATE_LIMIT_DEPENDENCY_UNAVAILABLE",
    message: "Protected request limiting is temporarily unavailable.",
    statusCode: 503,
    details: [],
  });
}

let configured: ProtectedUsersLimiterConfig | undefined;
const limiterCache = createManagedCache(
  async () => {
    if (!configured) throw unavailable();
    if (configured.mode === "local") return createLocalProtectedUsersLimiter();
    if (configured.mode === "trusted_edge") return createTrustedEdgeProtectedUsersLimiter();
    return createRedisProtectedUsersLimiter({ url: configured.redisUrl });
  },
  async (limiter) => limiter.close?.(),
);

export function getProtectedUsersLimiter(
  config: ProtectedUsersLimiterConfig,
): Promise<ProtectedUsersLimiter> {
  configured ??= { ...config };
  return limiterCache.get();
}

export async function closeProtectedUsersLimiter(): Promise<void> {
  try {
    await limiterCache.close();
  } finally {
    configured = undefined;
  }
}
