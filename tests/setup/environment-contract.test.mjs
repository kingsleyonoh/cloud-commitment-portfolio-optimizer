import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { pathToFileURL } from "node:url";

function declaredEnvironmentNames(text) {
  return new Set(
    text
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.split("=", 1)[0]),
  );
}

test("app, deployment-only, and test-only live-service declarations have strict key parity", async () => {
  const [{ DEPLOYMENT_ENV_KEYS, ENV_KEYS, TEST_ENV_KEYS, parseEnvironment }, example, local] =
    await Promise.all([
      import(pathToFileURL("core/config/env.ts").href),
      readFile(".env.example", "utf8"),
      readFile(".env.local", "utf8"),
    ]);

  assert.deepEqual(TEST_ENV_KEYS, ["TEST_DATABASE_ADMIN_URL", "TEST_REDIS_URL"]);
  for (const key of TEST_ENV_KEYS) {
    assert.equal(ENV_KEYS.includes(key), false);
    assert.equal(DEPLOYMENT_ENV_KEYS.includes(key), false);
    assert.match(example, new RegExp(`^${key}=$`, "mu"));
  }

  const declaredKeys = new Set([...ENV_KEYS, ...DEPLOYMENT_ENV_KEYS, ...TEST_ENV_KEYS]);
  assert.deepEqual(declaredEnvironmentNames(example), declaredKeys);
  assert.deepEqual(declaredEnvironmentNames(local), declaredKeys);
  const appEnv = { NODE_ENV: "development" };
  assert.deepEqual(
    parseEnvironment({
      ...appEnv,
      TEST_DATABASE_ADMIN_URL: "runner-only",
      TEST_REDIS_URL: "runner-only",
    }),
    parseEnvironment(appEnv),
  );
});
