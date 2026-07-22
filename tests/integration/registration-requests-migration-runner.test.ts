import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { Client } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../core/db/migrations.js";
import {
  createIsolatedDatabase,
  dropIsolatedDatabase,
  type IsolatedDatabase,
} from "./helpers/postgres-database.js";

const execFileAsync = promisify(execFile);
const migrationsDirectory = resolve("db/migrations");
const migrationFilenames = [
  "0001_create_tenants.sql",
  "0002_create_users.sql",
  "0003_create_api_keys.sql",
  "0004_create_registration_requests.sql",
  "0005_create_audit_log.sql",
] as const;
const allMigrationFilenames = [
  ...migrationFilenames,
  "0006_create_user_auth_credentials.sql",
  "0007_create_auth_refresh_families.sql",
  "0008_create_auth_refresh_tokens.sql",
  "0009_create_cloud_accounts.sql",
  "0010_create_import_batches.sql",
  "0011_create_usage_line_items.sql",
  "0012_create_price_table_versions.sql",
  "0013_create_price_table_items.sql",
  "0014_create_forecast_models.sql",
  "0015_create_forecast_runs.sql",
] as const;
const acceptedHashes = {
  "0001_create_tenants.sql": "d6ecd27b3f264c4bf8c0034697a6b21cb46c887beb26542d7958641cf30d5cba",
  "0002_create_users.sql": "07e669075706defc740198aab7d1eaf8c058f6d7e30832a1b26565b99f42e79e",
  "0003_create_api_keys.sql": "c9f239dcebed86629a07d29536c3fa9b22c5ca31da1158f0c0aafce2025f3b4d",
} as const;
let databases: IsolatedDatabase[] = [];
let temporaryDirectories: string[] = [];

async function freshDatabase(prefix: string): Promise<IsolatedDatabase> {
  const database = await createIsolatedDatabase(prefix);
  databases.push(database);
  return database;
}

async function temporaryMigrationDirectory(files: readonly string[]): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "ccpo-registration-migration-"));
  temporaryDirectories.push(directory);
  await Promise.all(
    files.map((filename) =>
      copyFile(join(migrationsDirectory, filename), join(directory, filename)),
    ),
  );
  return directory;
}

async function readCounts(databaseUrl: string) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const result = await client.query<{
    tenants: string;
    users: string;
    api_keys: string;
    registration_requests: string;
  }>(`
    SELECT (SELECT count(*) FROM tenants)::text AS tenants,
           (SELECT count(*) FROM users)::text AS users,
           (SELECT count(*) FROM api_keys)::text AS api_keys,
           (SELECT count(*) FROM registration_requests)::text AS registration_requests
  `);
  await client.end();
  return result.rows[0];
}

afterEach(async () => {
  await Promise.all(databases.map((database) => dropIsolatedDatabase(database)));
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true })));
  databases = [];
  temporaryDirectories = [];
});

describe("production registration-request migration runner and CLI", () => {
  it("preserves accepted 0001-0003 bytes", async () => {
    for (const [filename, expected] of Object.entries(acceptedHashes)) {
      const contents = await readFile(join(migrationsDirectory, filename));
      expect(createHash("sha256").update(contents).digest("hex"), filename).toBe(expected);
    }
  });

  it("applies the current plan through 0013, re-applies unchanged, and creates zero rows", async () => {
    const database = await freshDatabase("ccpo_registration_apply");
    const first = await runMigrations({ databaseUrl: database.url, migrationsDirectory });
    const second = await runMigrations({ databaseUrl: database.url, migrationsDirectory });
    const client = new Client({ connectionString: database.url });
    await client.connect();
    const receipts = await client.query<{ filename: string }>(
      "SELECT filename FROM _ccpo_schema_migrations ORDER BY version",
    );
    await client.end();

    expect(first).toEqual({ applied: [...allMigrationFilenames], skipped: [] });
    expect(second).toEqual({ applied: [], skipped: [...allMigrationFilenames] });
    expect(receipts.rows.map(({ filename }) => filename)).toEqual([...allMigrationFilenames]);
    expect(await readCounts(database.url)).toEqual({
      tenants: "0",
      users: "0",
      api_keys: "0",
      registration_requests: "0",
    });
  });

  it("uses the production CLI for apply and unchanged reapply", async () => {
    const database = await freshDatabase("ccpo_registration_cli");
    const command = [resolve("node_modules/tsx/dist/cli.mjs"), resolve("scripts/db-migrate.ts")];
    const options = { cwd: resolve("."), env: { ...process.env, DATABASE_URL: database.url } };
    const first = await execFileAsync(process.execPath, command, options);
    const second = await execFileAsync(process.execPath, command, options);

    expect(first.stdout).toContain("Migrations complete: 15 applied, 0 unchanged.");
    expect(first.stdout).toContain("applied 0013_create_price_table_items.sql");
    expect(second.stdout).toContain("Migrations complete: 0 applied, 15 unchanged.");
    expect(first.stderr).toBe("");
    expect(second.stderr).toBe("");
    expect((await readCounts(database.url))?.registration_requests).toBe("0");
  });

  it("serializes concurrent clean applies with one receipt per version", async () => {
    const database = await freshDatabase("ccpo_registration_concurrent");
    const results = await Promise.all([
      runMigrations({ databaseUrl: database.url, migrationsDirectory }),
      runMigrations({ databaseUrl: database.url, migrationsDirectory }),
    ]);
    const client = new Client({ connectionString: database.url });
    await client.connect();
    const receipts = await client.query<{ version: string; count: string }>(`
      SELECT version, count(*) FROM _ccpo_schema_migrations
      GROUP BY version ORDER BY version
    `);
    await client.end();

    expect(results).toContainEqual({ applied: [...allMigrationFilenames], skipped: [] });
    expect(results).toContainEqual({ applied: [], skipped: [...allMigrationFilenames] });
    expect(receipts.rows).toEqual(
      allMigrationFilenames.map((filename) => ({ version: filename.slice(0, 4), count: "1" })),
    );
  });

  it("rolls back failed 0004, preserves 0001-0003, then detects checksum drift", async () => {
    const database = await freshDatabase("ccpo_registration_drift");
    const directory = await temporaryMigrationDirectory(migrationFilenames.slice(0, 3));
    await runMigrations({ databaseUrl: database.url, migrationsDirectory: directory });
    const migrationPath = join(directory, migrationFilenames[3]);
    const canonicalSql = await readFile(join(migrationsDirectory, migrationFilenames[3]), "utf8");
    await writeFile(
      migrationPath,
      `${canonicalSql}\nSELECT ccpo_missing_registration_function();\n`,
    );

    await expect(
      runMigrations({ databaseUrl: database.url, migrationsDirectory: directory }),
    ).rejects.toThrow(/failed to apply migration 0004/iu);
    const client = new Client({ connectionString: database.url });
    await client.connect();
    const rolledBack = await client.query<{
      table_name: string | null;
      support_index: string | null;
    }>(`
      SELECT to_regclass('public.registration_requests')::text AS table_name,
             to_regclass('public.api_keys_tenant_id_id_key')::text AS support_index
    `);
    const receiptsBefore = await client.query<{ version: string }>(
      "SELECT version FROM _ccpo_schema_migrations ORDER BY version",
    );
    expect(rolledBack.rows[0]).toEqual({ table_name: null, support_index: null });
    expect(receiptsBefore.rows.map(({ version }) => version)).toEqual(["0001", "0002", "0003"]);

    await writeFile(migrationPath, canonicalSql);
    await runMigrations({ databaseUrl: database.url, migrationsDirectory: directory });
    await writeFile(migrationPath, `${canonicalSql}\n-- drift\n`);
    await expect(
      runMigrations({ databaseUrl: database.url, migrationsDirectory: directory }),
    ).rejects.toThrow(/checksum drift.*0004/iu);
    const receiptsAfter = await client.query<{ version: string }>(
      "SELECT version FROM _ccpo_schema_migrations ORDER BY version",
    );
    const rows = await client.query<{ count: string }>(
      "SELECT count(*) FROM registration_requests",
    );
    await client.end();

    expect(receiptsAfter.rows.map(({ version }) => version)).toEqual([
      "0001",
      "0002",
      "0003",
      "0004",
    ]);
    expect(rows.rows[0]?.count).toBe("0");
  });
});
