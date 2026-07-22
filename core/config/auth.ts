import ipaddr from "ipaddr.js";

import {
  EnvironmentValidationError,
  type AppConfig,
  type EnvironmentSource,
  type NodeEnvironment,
} from "./env-schema.js";
import { booleanValue, integerValue, oneOf, required, value } from "./env-values.js";

export function parseAuth(source: EnvironmentSource, nodeEnv: NodeEnvironment): AppConfig["auth"] {
  const production = nodeEnv === "production";
  const config: AppConfig["auth"] = {
    jwtIssuer: authIdentifier(source, "JWT_ISSUER", production, "ccpo"),
    jwtAudience: authIdentifier(source, "JWT_AUDIENCE", production, "ccpo-ui"),
    jwtPrivateKeyPath: production
      ? required(source, "JWT_PRIVATE_KEY_PATH")
      : value(source, "JWT_PRIVATE_KEY_PATH"),
    jwtPublicKeyPath: production
      ? required(source, "JWT_PUBLIC_KEY_PATH")
      : value(source, "JWT_PUBLIC_KEY_PATH"),
    jwtAccessTokenMaxLifetimeSeconds: integerValue(
      source,
      "JWT_ACCESS_TOKEN_MAX_LIFETIME_SECONDS",
      900,
      1,
      900,
    ),
    jwtClockToleranceSeconds: integerValue(source, "JWT_CLOCK_TOLERANCE_SECONDS", 30, 0, 30),
    argonConcurrency: integerValue(source, "AUTH_ARGON_CONCURRENCY", 2, 1, 2),
    argonQueueLimit: integerValue(source, "AUTH_ARGON_QUEUE_LIMIT", 32, 0, 32),
    limiterMode: oneOf(
      source,
      "AUTH_LIMITER_MODE",
      ["local", "redis"] as const,
      production ? "redis" : "local",
    ),
    trustedProxyCidrs: authProxyCidrs(source),
    cookieSecure: booleanValue(source, "AUTH_COOKIE_SECURE", production),
  };
  validateProductionAuth(config, production);
  return config;
}

function authProxyCidrs(source: EnvironmentSource): string[] {
  const entries = value(source, "AUTH_TRUSTED_PROXY_CIDRS")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const entry of entries) {
    if (entry.includes("%") || (!ipaddr.isValid(entry) && !ipaddr.isValidCIDR(entry))) {
      throw new EnvironmentValidationError(
        "AUTH_TRUSTED_PROXY_CIDRS must contain explicit IP addresses or CIDRs.",
      );
    }
  }
  return entries;
}

function validateProductionAuth(config: AppConfig["auth"], production: boolean): void {
  if (!production) return;
  if (config.limiterMode !== "redis") {
    throw new EnvironmentValidationError("Production auth limiting requires Redis.");
  }
  if (!config.cookieSecure) {
    throw new EnvironmentValidationError("Production auth cookies must be secure.");
  }
}

function authIdentifier(
  source: EnvironmentSource,
  key: string,
  production: boolean,
  fallback: string,
): string {
  const result = required(source, key, production ? "" : fallback);
  if (result.length > 256 || hasControlCharacters(result)) {
    throw new EnvironmentValidationError(`${key} must be a safe nonblank identifier.`);
  }
  return result;
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127;
  });
}
