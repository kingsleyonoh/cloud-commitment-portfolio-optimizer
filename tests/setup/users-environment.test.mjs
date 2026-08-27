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

test("protected users limiting defaults local outside production and Redis in production", async () => {
  const { parseEnvironment } = await loadConfig();
  assert.equal(parseEnvironment({ NODE_ENV: "test" }).users.limiterMode, "local");
  assert.equal(parseEnvironment(productionEnv()).users.limiterMode, "redis");
});

test("production rejects process-local protected users limiting", async () => {
  const { EnvironmentValidationError, parseEnvironment } = await loadConfig();
  assert.throws(
    () => parseEnvironment(productionEnv({ USERS_LIMITER_MODE: "local" })),
    EnvironmentValidationError,
  );
});

test("trusted edge users limiting requires explicit ack and proxy allowlist", async () => {
  const { EnvironmentValidationError, parseEnvironment } = await loadConfig();
  for (const overrides of [
    { USERS_LIMITER_MODE: "trusted_edge" },
    { USERS_LIMITER_MODE: "trusted_edge", USERS_TRUSTED_EDGE_ACK: "true" },
    {
      USERS_LIMITER_MODE: "trusted_edge",
      USERS_TRUSTED_EDGE_ACK: "true",
      USERS_TRUSTED_PROXY_CIDRS: "*",
    },
  ]) {
    assert.throws(() => parseEnvironment(productionEnv(overrides)), EnvironmentValidationError);
  }
  const config = parseEnvironment(
    productionEnv({
      USERS_LIMITER_MODE: "trusted_edge",
      USERS_TRUSTED_EDGE_ACK: "true",
      USERS_TRUSTED_PROXY_CIDRS: "10.0.0.0/8,2001:db8::1",
    }),
  );
  assert.deepEqual(config.users.trustedProxyCidrs, ["10.0.0.0/8", "2001:db8::1"]);
});
