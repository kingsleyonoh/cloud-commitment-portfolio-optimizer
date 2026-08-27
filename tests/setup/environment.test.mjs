import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";

async function loadConfigModule() {
  return import(pathToFileURL("core/config/env.ts").href);
}

function developmentEnv(overrides = {}) {
  return {
    NODE_ENV: "development",
    ...overrides,
  };
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

test("development uses typed, standalone-safe local defaults", async () => {
  const { parseEnvironment } = await loadConfigModule();
  const config = parseEnvironment(developmentEnv());

  assert.equal(config.runtime.nodeEnv, "development");
  assert.equal(config.runtime.port, 8080);
  assert.equal(config.database.url, "postgresql://user@localhost:5432/ccpo");
  assert.equal(config.database.localPort, 5432);
  assert.deepEqual(config.database.pool, {
    max: 10,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
  });
  assert.equal(config.queue.localPort, 6379);
  assert.equal(config.storage.duckdbTempDir, ".tmp/duckdb");
  assert.equal(config.storage.objectStoragePath, ".data/objects");
  assert.equal(config.integrations.notificationHub.enabled, false);
  assert.equal(config.integrations.workflowEngine.enabled, false);
  assert.equal(config.integrations.invoiceReconciliation.enabled, false);
});

test("local service port overrides are typed and bounded", async () => {
  const { parseEnvironment } = await loadConfigModule();
  const config = parseEnvironment(developmentEnv({ POSTGRES_PORT: "55432", REDIS_PORT: "56379" }));

  assert.equal(config.database.localPort, 55432);
  assert.equal(config.queue.localPort, 56379);
});

test("test and development can request an OS-assigned app port but production cannot", async () => {
  const { EnvironmentValidationError, parseEnvironment } = await loadConfigModule();

  assert.equal(parseEnvironment(developmentEnv({ PORT: "0" })).runtime.port, 0);
  assert.equal(parseEnvironment({ NODE_ENV: "test", PORT: "0" }).runtime.port, 0);
  assert.throws(() => parseEnvironment(productionEnv({ PORT: "0" })), EnvironmentValidationError);
});

test("production accepts explicit service endpoints and bounded database pool settings", async () => {
  const { parseEnvironment } = await loadConfigModule();
  const config = parseEnvironment(productionEnv());

  assert.equal(config.runtime.nodeEnv, "production");
  assert.equal(config.database.url, "postgresql://db.internal:5432/ccpo");
  assert.deepEqual(config.database.pool, {
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  assert.equal(config.queue.url, "redis://redis.internal:6379");
  assert.deepEqual(config.runtime.allowedOrigins, ["https://optimizer.example.test"]);
});

test("production requires every database pool boundary explicitly", async () => {
  const { EnvironmentValidationError, parseEnvironment } = await loadConfigModule();

  for (const key of ["DB_POOL_MAX", "DB_POOL_IDLE_TIMEOUT_MS", "DB_POOL_CONNECTION_TIMEOUT_MS"]) {
    const source = productionEnv();
    delete source[key];
    assert.throws(
      () => parseEnvironment(source),
      (error) =>
        error instanceof EnvironmentValidationError &&
        error.message.includes(key) &&
        !error.message.includes("undefined"),
    );
  }
});

function assertPoolBoundaryEndpoints(parseEnvironment) {
  const minimums = parseEnvironment(
    developmentEnv({
      DB_POOL_MAX: "1",
      DB_POOL_IDLE_TIMEOUT_MS: "1000",
      DB_POOL_CONNECTION_TIMEOUT_MS: "250",
    }),
  );
  const maximums = parseEnvironment(
    developmentEnv({
      DB_POOL_MAX: "100",
      DB_POOL_IDLE_TIMEOUT_MS: "300000",
      DB_POOL_CONNECTION_TIMEOUT_MS: "60000",
    }),
  );

  assert.deepEqual(minimums.database.pool, {
    max: 1,
    idleTimeoutMillis: 1000,
    connectionTimeoutMillis: 250,
  });
  assert.deepEqual(maximums.database.pool, {
    max: 100,
    idleTimeoutMillis: 300000,
    connectionTimeoutMillis: 60000,
  });
}

function assertInvalidPoolBoundaries(parseEnvironment, EnvironmentValidationError) {
  for (const [key, invalid] of [
    ["DB_POOL_MAX", "0"],
    ["DB_POOL_MAX", "101"],
    ["DB_POOL_MAX", "1.5"],
    ["DB_POOL_IDLE_TIMEOUT_MS", "999"],
    ["DB_POOL_IDLE_TIMEOUT_MS", "300001"],
    ["DB_POOL_CONNECTION_TIMEOUT_MS", "249"],
    ["DB_POOL_CONNECTION_TIMEOUT_MS", "60001"],
    ["DB_POOL_CONNECTION_TIMEOUT_MS", "not-a-number"],
  ]) {
    assert.throws(
      () => parseEnvironment(developmentEnv({ [key]: invalid })),
      EnvironmentValidationError,
    );
  }
}

test("database pool boundaries accept endpoints and reject invalid values", async () => {
  const { EnvironmentValidationError, parseEnvironment } = await loadConfigModule();
  assertPoolBoundaryEndpoints(parseEnvironment);
  assertInvalidPoolBoundaries(parseEnvironment, EnvironmentValidationError);
});

test("invalid enums, booleans, and bounded numbers fail closed", async () => {
  const { EnvironmentValidationError, parseEnvironment } = await loadConfigModule();

  assert.throws(
    () => parseEnvironment(developmentEnv({ NODE_ENV: "preview" })),
    EnvironmentValidationError,
  );
  assert.throws(
    () => parseEnvironment(developmentEnv({ SELF_REGISTRATION_ENABLED: "yes" })),
    EnvironmentValidationError,
  );
  assert.throws(
    () => parseEnvironment(developmentEnv({ PORT: "70000" })),
    EnvironmentValidationError,
  );
});

test("production rejects missing network configuration and loopback public URLs", async () => {
  const { EnvironmentValidationError, parseEnvironment } = await loadConfigModule();
  const env = productionEnv();
  delete env.DATABASE_URL;

  assert.throws(() => parseEnvironment(env), EnvironmentValidationError);
  for (const publicBaseUrl of [
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    "http://[::1]:8080",
  ]) {
    assert.throws(
      () => parseEnvironment(productionEnv({ PUBLIC_BASE_URL: publicBaseUrl })),
      (error) =>
        error instanceof EnvironmentValidationError &&
        error.message.includes("PUBLIC_BASE_URL") &&
        !error.message.includes(publicBaseUrl),
    );
  }
});

test("enabled optional adapters require credentials without exposing values", async () => {
  const { EnvironmentValidationError, parseEnvironment } = await loadConfigModule();

  assert.throws(
    () =>
      parseEnvironment(
        developmentEnv({ NOTIFICATION_HUB_ENABLED: "true", NOTIFICATION_HUB_API_KEY: "" }),
      ),
    (error) =>
      error instanceof EnvironmentValidationError &&
      error.message.includes("NOTIFICATION_HUB_API_KEY") &&
      !error.message.includes("undefined"),
  );
});

test("Invoice Reconciliation remains disabled without a verified contract", async () => {
  const { EnvironmentValidationError, parseEnvironment } = await loadConfigModule();

  assert.throws(
    () =>
      parseEnvironment(
        developmentEnv({
          INVOICE_RECON_ENABLED: "true",
          INVOICE_RECON_CONTRACT_VERIFIED: "false",
        }),
      ),
    (error) =>
      error instanceof EnvironmentValidationError && error.code === "ENDPOINT_CONTRACT_UNVERIFIED",
  );
});
