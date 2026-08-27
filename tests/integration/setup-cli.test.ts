import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createIsolatedDatabase,
  dropIsolatedDatabase,
  type IsolatedDatabase,
} from "./helpers/postgres-database.js";
import { safeFirstRunSnapshot } from "./helpers/first-run-database.js";
import { runSafeSetupCli } from "./helpers/setup-cli.js";

const migrationsDirectory = resolve("db/migrations");
let database: IsolatedDatabase | undefined;

afterEach(async () => {
  await dropIsolatedDatabase(database);
  database = undefined;
});

describe.sequential("actual npm setup CLI", () => {
  it("prints the machine-readable credential once and safe metadata on rerun", async () => {
    database = await createIsolatedDatabase("ccpo_setup_cli");
    const first = await runSafeSetupCli(database.url, migrationsDirectory);
    const second = await runSafeSetupCli(database.url, migrationsDirectory);
    const snapshot = await safeFirstRunSnapshot(database.url);

    expect(first.exitCode).toBe(0);
    expect(first.credentialCount).toBe(1);
    expect(first.stderrContainedCredential).toBe(false);
    expect(first.stdout).toContain('"created":true');
    expect(first.stdout).toContain("[ONE_TIME_CREDENTIAL_REDACTED]");
    expect(second.exitCode).toBe(0);
    expect(second.credentialCount).toBe(0);
    expect(second.stderrContainedCredential).toBe(false);
    expect(second.stdout).toContain('"created":false');
    expect(second.stdout).not.toContain("[ONE_TIME_CREDENTIAL_REDACTED]");
    expect(snapshot).toMatchObject({ tenantCount: 1, userCount: 0, keyCount: 1 });
  });
});
