import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";

async function loadConfig() {
  return import(pathToFileURL("core/config/env.ts").href);
}

function developmentEnv(overrides = {}) {
  return { NODE_ENV: "development", ...overrides };
}

test("fresh admin metadata and password-file path are jointly configured", async () => {
  const { EnvironmentValidationError, parseEnvironment } = await loadConfig();
  const configured = parseEnvironment(
    developmentEnv({
      DEFAULT_ADMIN_EMAIL: "  ADMIN@Example.Invalid  ",
      DEFAULT_ADMIN_NAME: "  Ada Admin  ",
      DEFAULT_ADMIN_PASSWORD_FILE: "  /run/secrets/admin-password  ",
    }),
  );
  assert.equal(configured.tenant.defaultAdminEmail, "admin@example.invalid");
  assert.equal(configured.tenant.defaultAdminName, "Ada Admin");
  assert.equal(configured.tenant.defaultAdminPasswordFile, "/run/secrets/admin-password");

  for (const overrides of [
    { DEFAULT_ADMIN_EMAIL: "admin@example.invalid", DEFAULT_ADMIN_NAME: "Admin" },
    { DEFAULT_ADMIN_EMAIL: "admin@example.invalid", DEFAULT_ADMIN_PASSWORD_FILE: "/secret" },
    { DEFAULT_ADMIN_NAME: "Admin", DEFAULT_ADMIN_PASSWORD_FILE: "/secret" },
    { DEFAULT_ADMIN_PASSWORD_FILE: "/secret" },
  ]) {
    assert.throws(() => parseEnvironment(developmentEnv(overrides)), EnvironmentValidationError);
  }
});

test("Argon executor configuration is bounded by the production policy", async () => {
  const { EnvironmentValidationError, parseEnvironment } = await loadConfig();
  const defaults = parseEnvironment(developmentEnv()).auth;
  assert.equal(defaults.argonConcurrency, 2);
  assert.equal(defaults.argonQueueLimit, 32);

  for (const overrides of [
    { AUTH_ARGON_CONCURRENCY: "0" },
    { AUTH_ARGON_CONCURRENCY: "3" },
    { AUTH_ARGON_QUEUE_LIMIT: "-1" },
    { AUTH_ARGON_QUEUE_LIMIT: "33" },
  ]) {
    assert.throws(() => parseEnvironment(developmentEnv(overrides)), EnvironmentValidationError);
  }
});
