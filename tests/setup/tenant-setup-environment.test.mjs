import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";

async function loadConfigModule() {
  return import(pathToFileURL("core/config/env.ts").href);
}

function developmentEnv(overrides = {}) {
  return { NODE_ENV: "development", ...overrides };
}

test("tenant setup env is normalized and admin name is conditionally required", async () => {
  const { EnvironmentValidationError, parseEnvironment } = await loadConfigModule();
  const withoutAdmin = parseEnvironment(
    developmentEnv({ DEFAULT_TENANT_NAME: "  Cafe\u0301 Holdings  " }),
  );
  assert.equal(withoutAdmin.tenant.defaultTenantName, "Café Holdings");
  assert.equal(withoutAdmin.tenant.defaultAdminEmail, "");
  assert.equal(withoutAdmin.tenant.defaultAdminName, "");

  const withAdmin = parseEnvironment(
    developmentEnv({
      DEFAULT_ADMIN_EMAIL: "  ADMIN@Example.Invalid  ",
      DEFAULT_ADMIN_NAME: "  Ada Admin  ",
      DEFAULT_ADMIN_PASSWORD_FILE: "  /run/secrets/admin-password  ",
    }),
  );
  assert.equal(withAdmin.tenant.defaultAdminEmail, "admin@example.invalid");
  assert.equal(withAdmin.tenant.defaultAdminName, "Ada Admin");
  assert.equal(withAdmin.tenant.defaultAdminPasswordFile, "/run/secrets/admin-password");

  assert.throws(
    () => parseEnvironment(developmentEnv({ DEFAULT_ADMIN_EMAIL: "admin@example.invalid" })),
    (error) =>
      error instanceof EnvironmentValidationError && error.message.includes("DEFAULT_ADMIN_NAME"),
  );
  assert.throws(
    () => parseEnvironment(developmentEnv({ DEFAULT_ADMIN_NAME: "Ada Admin" })),
    (error) =>
      error instanceof EnvironmentValidationError && error.message.includes("DEFAULT_ADMIN_EMAIL"),
  );
});

test("tenant setup env rejects malformed email, blank name, and unsafe key prefixes", async () => {
  const { EnvironmentValidationError, parseEnvironment } = await loadConfigModule();
  for (const override of [
    { DEFAULT_TENANT_NAME: "  " },
    { DEFAULT_ADMIN_EMAIL: "not-an-email", DEFAULT_ADMIN_NAME: "Admin" },
    { API_KEY_PREFIX: "CCPO" },
    { API_KEY_PREFIX: "1ccpo" },
    { API_KEY_PREFIX: "abcdefghijklmnopq" },
  ]) {
    assert.throws(() => parseEnvironment(developmentEnv(override)), EnvironmentValidationError);
  }
});
