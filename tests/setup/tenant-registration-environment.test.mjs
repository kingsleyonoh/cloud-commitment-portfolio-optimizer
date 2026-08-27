import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";

async function loadConfig() {
  return import(pathToFileURL("core/config/env.ts").href);
}

function productionEnv(overrides = {}) {
  return {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://db.internal:5432/ccpo",
    REDIS_URL: "redis://redis.internal:6379",
    PUBLIC_BASE_URL: "https://optimizer.example.test",
    ALLOWED_ORIGINS: "https://optimizer.example.test",
    DEPLOYMENT_REGION: "eu-test-1",
    DATABASE_REGION: "eu-test-1",
    DB_POOL_MAX: "20",
    DB_POOL_IDLE_TIMEOUT_MS: "30000",
    DB_POOL_CONNECTION_TIMEOUT_MS: "5000",
    JWT_ISSUER: "ccpo",
    JWT_AUDIENCE: "ccpo-ui",
    JWT_PRIVATE_KEY_PATH: "/run/config/jwt-private.pem",
    JWT_PUBLIC_KEY_PATH: "/run/config/jwt-public.pem",
    ...overrides,
  };
}

test("self-registration is fail-safe disabled by default", async () => {
  const { parseEnvironment } = await loadConfig();
  const development = parseEnvironment({ NODE_ENV: "development" });
  const production = parseEnvironment(productionEnv());

  assert.equal(development.tenant.selfRegistrationEnabled, false);
  assert.equal(development.tenant.registrationLimiterMode, "local");
  assert.equal(production.tenant.selfRegistrationEnabled, false);
});

test("enabled production requires acknowledgement and a production-safe mode", async () => {
  const { EnvironmentValidationError, parseEnvironment } = await loadConfig();
  const invalid = [
    { SELF_REGISTRATION_ENABLED: "true" },
    {
      SELF_REGISTRATION_ENABLED: "true",
      SELF_REGISTRATION_PRODUCTION_ACK: "true",
      REGISTRATION_LIMITER_MODE: "local",
    },
  ];
  for (const overrides of invalid) {
    assert.throws(() => parseEnvironment(productionEnv(overrides)), EnvironmentValidationError);
  }

  const redis = parseEnvironment(
    productionEnv({
      SELF_REGISTRATION_ENABLED: "true",
      SELF_REGISTRATION_PRODUCTION_ACK: "true",
      REGISTRATION_LIMITER_MODE: "redis",
    }),
  );
  assert.equal(redis.tenant.registrationLimiterMode, "redis");
});

test("trusted edge mode requires enforcement and an explicit proxy allowlist", async () => {
  const { EnvironmentValidationError, parseEnvironment } = await loadConfig();
  const base = {
    SELF_REGISTRATION_ENABLED: "true",
    SELF_REGISTRATION_PRODUCTION_ACK: "true",
    REGISTRATION_LIMITER_MODE: "trusted_edge",
  };
  for (const overrides of [
    base,
    { ...base, REGISTRATION_EDGE_ENFORCES_LIMIT: "true" },
    {
      ...base,
      REGISTRATION_EDGE_ENFORCES_LIMIT: "true",
      REGISTRATION_TRUSTED_PROXY_CIDRS: "*",
    },
  ]) {
    assert.throws(() => parseEnvironment(productionEnv(overrides)), EnvironmentValidationError);
  }

  const config = parseEnvironment(
    productionEnv({
      ...base,
      REGISTRATION_EDGE_ENFORCES_LIMIT: "true",
      REGISTRATION_TRUSTED_PROXY_CIDRS: "10.0.0.0/8,2001:db8::1",
    }),
  );
  assert.deepEqual(config.tenant.registrationTrustedProxyCidrs, ["10.0.0.0/8", "2001:db8::1"]);
});

test("invalid limiter modes, proxy entries, and booleans fail closed", async () => {
  const { EnvironmentValidationError, parseEnvironment } = await loadConfig();
  for (const overrides of [
    { REGISTRATION_LIMITER_MODE: "memory" },
    { REGISTRATION_TRUSTED_PROXY_CIDRS: "trust-all" },
    { REGISTRATION_TRUSTED_PROXY_CIDRS: "127.0.0.1/999" },
    { SELF_REGISTRATION_PRODUCTION_ACK: "yes" },
  ]) {
    assert.throws(
      () => parseEnvironment({ NODE_ENV: "development", ...overrides }),
      EnvironmentValidationError,
    );
  }
});
