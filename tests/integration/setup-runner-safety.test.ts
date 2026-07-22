import { resolve } from "node:path";
import { Client } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../core/db/migrations.js";
import { runSetup } from "../../core/db/setup.js";
import { FirstRunInitializationError } from "../../core/tenant/initialization.js";
import {
  createIsolatedDatabase,
  dropIsolatedDatabase,
  type IsolatedDatabase,
} from "./helpers/postgres-database.js";
import { safeFirstRunSnapshot } from "./helpers/first-run-database.js";

const migrationsDirectory = resolve("db/migrations");
let database: IsolatedDatabase | undefined;

function setupOptions() {
  return {
    databaseUrl: database!.url,
    migrationsDirectory,
    tenant: {
      defaultTenantName: "Concurrent Portfolio",
      defaultAdminEmail: "",
      defaultAdminName: "",
      apiKeyPrefix: "ccpo",
    },
  };
}

async function freshDatabase(prefix: string): Promise<void> {
  database = await createIsolatedDatabase(prefix);
}

async function execute(sql: string): Promise<void> {
  const client = new Client({ connectionString: database!.url });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

function isSafeAmbiguousError(error: unknown): boolean {
  return (
    error instanceof FirstRunInitializationError &&
    error.code === "INITIALIZATION_STATE_AMBIGUOUS" &&
    error.message === "First-run initialization state is ambiguous; no changes were made."
  );
}

afterEach(async () => {
  await dropIsolatedDatabase(database);
  database = undefined;
});

describe.sequential("first-run setup safety", () => {
  it("serializes concurrent callers to exactly one created result", async () => {
    await freshDatabase("ccpo_setup_concurrent");
    const results = await Promise.all([runSetup(setupOptions()), runSetup(setupOptions())]);
    const createdCount = results.filter((result) => result.initialization.created).length;
    const plaintextCount = results.filter((result) => "apiKey" in result.initialization).length;
    const snapshot = await safeFirstRunSnapshot(database!.url);

    expect(createdCount).toBe(1);
    expect(plaintextCount).toBe(1);
    expect(snapshot).toMatchObject({ tenantCount: 1, userCount: 0, keyCount: 1, markerCount: 1 });
  });

  it("rolls back tenant, admin, and key rows when the key insert fails", async () => {
    await freshDatabase("ccpo_setup_rollback");
    await runMigrations({ databaseUrl: database!.url, migrationsDirectory });
    await execute(`
      CREATE FUNCTION reject_first_run_key() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'test-only insert failure'; END;
      $$;
      CREATE TRIGGER reject_first_run_key BEFORE INSERT ON api_keys
      FOR EACH ROW EXECUTE FUNCTION reject_first_run_key();
    `);

    await expect(runSetup(setupOptions())).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof FirstRunInitializationError &&
        error.code === "INITIALIZATION_FAILED" &&
        !error.message.includes("test-only"),
    );
    expect(await safeFirstRunSnapshot(database!.url)).toMatchObject({
      tenantCount: 0,
      userCount: 0,
      keyCount: 0,
      markerCount: 0,
    });

    await execute(
      "DROP TRIGGER reject_first_run_key ON api_keys; DROP FUNCTION reject_first_run_key();",
    );
    const retry = await runSetup(setupOptions());
    expect(retry.initialization.created).toBe(true);
  });

  it("fails closed on a partial tenant-only state", async () => {
    await freshDatabase("ccpo_setup_partial");
    await runMigrations({ databaseUrl: database!.url, migrationsDirectory });
    await execute(`INSERT INTO tenants (name, legal_name, full_legal_name, display_name)
      VALUES ('Partial', 'Partial', 'Partial', 'Partial')`);

    await expect(runSetup(setupOptions())).rejects.toSatisfy(isSafeAmbiguousError);
    expect(await safeFirstRunSnapshot(database!.url)).toMatchObject({
      tenantCount: 1,
      keyCount: 0,
    });
  });

  it("fails closed on multiple or mismatched initialized state", async () => {
    await freshDatabase("ccpo_setup_multiple");
    await runSetup(setupOptions());
    await execute(`INSERT INTO tenants (name, legal_name, full_legal_name, display_name)
      VALUES ('Extra', 'Extra', 'Extra', 'Extra')`);

    await expect(runSetup(setupOptions())).rejects.toSatisfy(isSafeAmbiguousError);
    expect(await safeFirstRunSnapshot(database!.url)).toMatchObject({
      tenantCount: 2,
      keyCount: 1,
      markerCount: 1,
    });
  });

  it("fails closed when initialized tenant identity no longer matches input", async () => {
    await freshDatabase("ccpo_setup_mismatch");
    await runSetup(setupOptions());
    await execute(`UPDATE tenants SET name = 'Changed', legal_name = 'Changed',
      full_legal_name = 'Changed', display_name = 'Changed'`);

    await expect(runSetup(setupOptions())).rejects.toSatisfy(isSafeAmbiguousError);
    expect(await safeFirstRunSnapshot(database!.url)).toMatchObject({
      tenantCount: 1,
      keyCount: 1,
      markerCount: 1,
    });
  });

  it("fails closed when the initialized key is revoked", async () => {
    await freshDatabase("ccpo_setup_revoked");
    await runSetup(setupOptions());
    await execute("UPDATE api_keys SET revoked_at = now() WHERE note = 'system:first-run:v1'");

    await expect(runSetup(setupOptions())).rejects.toSatisfy(isSafeAmbiguousError);
    expect(await safeFirstRunSnapshot(database!.url)).toMatchObject({
      tenantCount: 1,
      keyCount: 1,
      markerCount: 1,
      activeMarkerCount: 0,
    });
  });
});
