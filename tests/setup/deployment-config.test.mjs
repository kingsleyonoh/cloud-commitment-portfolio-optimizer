import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { pathToFileURL } from "node:url";

async function loadEnvironment() {
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

test("development and test default deployment and database regions to local", async () => {
  const { parseEnvironment } = await loadEnvironment();

  assert.deepEqual(parseEnvironment({ NODE_ENV: "development" }).deployment, {
    deploymentRegion: "local",
    databaseRegion: "local",
  });
  assert.deepEqual(parseEnvironment({ NODE_ENV: "test" }).deployment, {
    deploymentRegion: "local",
    databaseRegion: "local",
  });
});

test("production requires explicit matching deployment and database regions", async () => {
  const { parseEnvironment } = await loadEnvironment();
  const config = parseEnvironment(productionEnv());

  assert.equal(config.deployment.deploymentRegion, "eu-test-1");
  assert.equal(config.deployment.databaseRegion, "eu-test-1");

  for (const missing of ["DEPLOYMENT_REGION", "DATABASE_REGION"]) {
    const source = productionEnv();
    delete source[missing];
    assert.throws(
      () => parseEnvironment(source),
      (error) =>
        error.code === "DEPLOYMENT_REGION_REQUIRED" && !error.message.includes("undefined"),
    );
  }
});

test("production region mismatch fails with a stable safe code", async () => {
  const { parseEnvironment } = await loadEnvironment();

  assert.throws(
    () => parseEnvironment(productionEnv({ DATABASE_REGION: "eu-test-2" })),
    (error) =>
      error.code === "DEPLOYMENT_REGION_MISMATCH" &&
      !error.message.includes("eu-test-1") &&
      !error.message.includes("eu-test-2"),
  );
});

test("deployment config cache is immutable, coalesced, retryable, and resettable", async () => {
  const { createDeploymentConfigCache } = await import(
    pathToFileURL("core/config/deployment.ts").href
  );
  let attempts = 0;
  const cache = createDeploymentConfigCache(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("parse failed");
    return { deployment: { deploymentRegion: "local", databaseRegion: "local" } };
  });

  await assert.rejects(cache.get(), /parse failed/u);
  const [first, second] = await Promise.all([cache.get(), cache.get()]);
  assert.equal(first, second);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.deployment), true);
  await cache.close();
  await cache.get();
  assert.equal(attempts, 3);
  await cache.close();
});

test("region declarations stay in typed env, example, PRD, and production Compose", async () => {
  const [{ ENV_KEYS }, example, prd, compose] = await Promise.all([
    loadEnvironment(),
    readFile(".env.example", "utf8"),
    readFile("docs/cloud-commitment-portfolio-optimizer_prd.md", "utf8"),
    readFile("docker-compose.prod.yml", "utf8"),
  ]);

  for (const key of ["DEPLOYMENT_REGION", "DATABASE_REGION"]) {
    assert.ok(ENV_KEYS.includes(key));
    assert.match(example, new RegExp(`^${key}=local$`, "mu"));
    assert.match(prd, new RegExp(`^${key}=local$`, "mu"));
    assert.match(compose, new RegExp(`${key}: \\$\\{${key}:\\?`));
  }
});
