import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../core/db/migrations.js";
import { runSetup } from "../../core/db/setup.js";
import {
  createIsolatedDatabase,
  dropIsolatedDatabase,
  type IsolatedDatabase,
} from "./helpers/postgres-database.js";

const migrationsDirectory = resolve("db/migrations");
const migrationFilename = "0001_create_tenants.sql";
let databases: IsolatedDatabase[] = [];
let temporaryDirectories: string[] = [];

async function freshDatabase(prefix: string): Promise<IsolatedDatabase> {
  const database = await createIsolatedDatabase(prefix);
  databases.push(database);
  return database;
}

async function temporaryMigrationDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "ccpo-tenants-migration-"));
  temporaryDirectories.push(directory);
  await copyFile(join(migrationsDirectory, migrationFilename), join(directory, migrationFilename));
  return directory;
}

afterEach(async () => {
  await Promise.all(databases.map((database) => dropIsolatedDatabase(database)));
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true })));
  databases = [];
  temporaryDirectories = [];
});

describe("production tenants migration runner", () => {
  it("applies once, re-applies as unchanged, and keeps the database empty", async () => {
    const database = await freshDatabase("ccpo_tenants_apply");
    const directory = await temporaryMigrationDirectory();
    const first = await runMigrations({
      databaseUrl: database.url,
      migrationsDirectory: directory,
    });
    const second = await runMigrations({
      databaseUrl: database.url,
      migrationsDirectory: directory,
    });
    const client = new Client({ connectionString: database.url });
    await client.connect();
    const receipts = await client.query<{ filename: string }>(
      "SELECT filename FROM _ccpo_schema_migrations ORDER BY version",
    );
    const rows = await client.query<{ count: string }>("SELECT count(*) FROM tenants");
    await client.end();

    expect(first).toEqual({ applied: [migrationFilename], skipped: [] });
    expect(second).toEqual({ applied: [], skipped: [migrationFilename] });
    expect(receipts.rows).toEqual([{ filename: migrationFilename }]);
    expect(rows.rows[0]?.count).toBe("0");
  });

  it("serializes concurrent clean applies with one receipt", async () => {
    const database = await freshDatabase("ccpo_tenants_concurrent");
    const directory = await temporaryMigrationDirectory();
    const results = await Promise.all([
      runMigrations({ databaseUrl: database.url, migrationsDirectory: directory }),
      runMigrations({ databaseUrl: database.url, migrationsDirectory: directory }),
    ]);
    const client = new Client({ connectionString: database.url });
    await client.connect();
    const receipts = await client.query<{ count: string }>(
      "SELECT count(*) FROM _ccpo_schema_migrations WHERE version = '0001'",
    );
    await client.end();

    expect(results).toContainEqual({ applied: [migrationFilename], skipped: [] });
    expect(results).toContainEqual({ applied: [], skipped: [migrationFilename] });
    expect(receipts.rows[0]?.count).toBe("1");
  });

  it("rolls back a failed migration and then rejects checksum drift", async () => {
    const database = await freshDatabase("ccpo_tenants_drift");
    const directory = await temporaryMigrationDirectory();
    const path = join(directory, migrationFilename);
    const canonicalSql = await readFile(path, "utf8");
    await writeFile(path, `${canonicalSql}\nSELECT ccpo_missing_migration_function();\n`);

    await expect(
      runMigrations({ databaseUrl: database.url, migrationsDirectory: directory }),
    ).rejects.toThrow(/failed to apply migration/iu);
    const client = new Client({ connectionString: database.url });
    await client.connect();
    const rolledBack = await client.query<{ table_name: string | null }>(
      "SELECT to_regclass('public.tenants')::text AS table_name",
    );
    expect(rolledBack.rows[0]?.table_name).toBeNull();

    await writeFile(path, canonicalSql);
    await runMigrations({ databaseUrl: database.url, migrationsDirectory: directory });
    await writeFile(path, `${canonicalSql}\n-- drift\n`);
    await expect(
      runMigrations({ databaseUrl: database.url, migrationsDirectory: directory }),
    ).rejects.toThrow(/checksum drift.*0001/iu);
    const rows = await client.query<{ count: string }>("SELECT count(*) FROM tenants");
    await client.end();
    expect(rows.rows[0]?.count).toBe("0");
  });

  it("runs all accepted migrations before the typed first-run initializer", async () => {
    const database = await freshDatabase("ccpo_tenants_setup");
    const result = await runSetup({
      databaseUrl: database.url,
      migrationsDirectory,
      tenant: {
        defaultTenantName: "Migration Runner Tenant",
        defaultAdminEmail: "",
        defaultAdminName: "",
        apiKeyPrefix: "ccpo",
      },
    });
    const client = new Client({ connectionString: database.url });
    await client.connect();
    const rows = await client.query<{ count: string }>("SELECT count(*) FROM tenants");
    const keys = await client.query<{ count: string }>("SELECT count(*) FROM api_keys");
    await client.end();

    expect(result.initialization.created).toBe(true);
    expect(rows.rows[0]?.count).toBe("1");
    expect(keys.rows[0]?.count).toBe("1");
  });
});
