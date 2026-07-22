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
  "0004_create_registration_requests.sql":
    "c6612e110825c1c561f70cbf43b8e91c27047eec5ffd5e0af9294b601b6b0d42",
  "0005_create_audit_log.sql": "131ef18fa47ffd45a97e2ae5d7056aaa1b8fce4df2542ed20041d75be85a1160",
  "0006_create_user_auth_credentials.sql":
    "b44a0205508198ba95f845619ee9245adae58bd935e3980aa78309692109a489",
} as const;
let databases: IsolatedDatabase[] = [];
let temporaryDirectories: string[] = [];

async function freshDatabase(prefix: string): Promise<IsolatedDatabase> {
  const database = await createIsolatedDatabase(prefix);
  databases.push(database);
  return database;
}

async function temporaryMigrationDirectory(files: readonly string[]): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "ccpo-refresh-migration-"));
  temporaryDirectories.push(directory);
  await Promise.all(
    files.map((filename) =>
      copyFile(join(migrationsDirectory, filename), join(directory, filename)),
    ),
  );
  return directory;
}

async function schemaState(databaseUrl: string) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const relations = await client.query<{ families: string | null; tokens: string | null }>(`
    SELECT to_regclass('public.auth_refresh_families')::text AS families,
           to_regclass('public.auth_refresh_tokens')::text AS tokens
  `);
  const families = relations.rows[0]!.families;
  const tokens = relations.rows[0]!.tokens;
  const familyRows = families
    ? (await client.query<{ count: string }>("SELECT count(*) FROM auth_refresh_families")).rows[0]!
        .count
    : "0";
  const tokenRows = tokens
    ? (await client.query<{ count: string }>("SELECT count(*) FROM auth_refresh_tokens")).rows[0]!
        .count
    : "0";
  await client.end();
  return { families, tokens, family_rows: familyRows, token_rows: tokenRows };
}

afterEach(async () => {
  await Promise.all(databases.map((database) => dropIsolatedDatabase(database)));
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true })));
  databases = [];
  temporaryDirectories = [];
});

describe("production refresh schema migration runner and CLI", () => {
  it("preserves accepted 0001-0006 bytes and keeps 0007-0008 additive and row-free", async () => {
    for (const [filename, expected] of Object.entries(acceptedHashes)) {
      const contents = await readFile(join(migrationsDirectory, filename));
      expect(createHash("sha256").update(contents).digest("hex"), filename).toBe(expected);
    }
    for (const filename of migrationFilenames.slice(6)) {
      const sql = await readFile(join(migrationsDirectory, filename), "utf8");
      expect(sql).not.toMatch(/\bIF\s+NOT\s+EXISTS\b/iu);
      expect(sql).not.toMatch(/\bINSERT\s+INTO\b/iu);
      expect(sql).not.toMatch(/\bALTER\s+TABLE\s+(tenants|users|api_keys)\b/iu);
    }
  });

  it("applies the current plan through 0013, re-applies unchanged, and CLI reports counts only", async () => {
    const database = await freshDatabase("ccpo_refresh_apply");
    const first = await runMigrations({ databaseUrl: database.url, migrationsDirectory });
    const second = await runMigrations({ databaseUrl: database.url, migrationsDirectory });
    const command = [resolve("node_modules/tsx/dist/cli.mjs"), resolve("scripts/db-migrate.ts")];
    const cli = await execFileAsync(process.execPath, command, {
      cwd: resolve("."),
      env: { ...process.env, DATABASE_URL: database.url },
    });
    expect(first).toEqual({ applied: [...migrationFilenames], skipped: [] });
    expect(second).toEqual({ applied: [], skipped: [...migrationFilenames] });
    expect(cli.stdout).toBe("Migrations complete: 0 applied, 15 unchanged.\n");
    expect(cli.stderr).toBe("");
    expect(await schemaState(database.url)).toEqual({
      families: "auth_refresh_families",
      tokens: "auth_refresh_tokens",
      family_rows: "0",
      token_rows: "0",
    });
  });

  it("uses the production CLI for a clean ordered current-plan apply", async () => {
    const database = await freshDatabase("ccpo_refresh_cli");
    const command = [resolve("node_modules/tsx/dist/cli.mjs"), resolve("scripts/db-migrate.ts")];
    const result = await execFileAsync(process.execPath, command, {
      cwd: resolve("."),
      env: { ...process.env, DATABASE_URL: database.url },
    });
    expect(result.stdout).toContain("Migrations complete: 15 applied, 0 unchanged.");
    expect(result.stdout).toContain("applied 0007_create_auth_refresh_families.sql");
    expect(result.stdout).toContain("applied 0008_create_auth_refresh_tokens.sql");
    expect(result.stdout).toContain("applied 0013_create_price_table_items.sql");
    expect(result.stderr).toBe("");
  });

  it("serializes concurrent clean applies with one receipt per version", async () => {
    const database = await freshDatabase("ccpo_refresh_concurrent_apply");
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
    expect(results).toContainEqual({ applied: [...migrationFilenames], skipped: [] });
    expect(results).toContainEqual({ applied: [], skipped: [...migrationFilenames] });
    expect(receipts.rows).toEqual(
      migrationFilenames.map((filename) => ({ version: filename.slice(0, 4), count: "1" })),
    );
  });

  it("rolls back failed 0007 while preserving accepted 0001-0006", async () => {
    const database = await freshDatabase("ccpo_refresh_family_rollback");
    const directory = await temporaryMigrationDirectory(migrationFilenames.slice(0, 6));
    await runMigrations({ databaseUrl: database.url, migrationsDirectory: directory });
    const canonical = await readFile(join(migrationsDirectory, migrationFilenames[6]), "utf8");
    await writeFile(
      join(directory, migrationFilenames[6]),
      `${canonical}\nSELECT ccpo_missing_refresh_family_function();\n`,
    );
    await expect(
      runMigrations({ databaseUrl: database.url, migrationsDirectory: directory }),
    ).rejects.toThrow(/failed to apply migration 0007/iu);
    const state = await schemaState(database.url);
    expect(state).toEqual({ families: null, tokens: null, family_rows: "0", token_rows: "0" });
  });

  it("rolls back failed 0008 while preserving successful 0007", async () => {
    const database = await freshDatabase("ccpo_refresh_token_rollback");
    const directory = await temporaryMigrationDirectory(migrationFilenames.slice(0, 7));
    await runMigrations({ databaseUrl: database.url, migrationsDirectory: directory });
    const canonical = await readFile(join(migrationsDirectory, migrationFilenames[7]), "utf8");
    await writeFile(
      join(directory, migrationFilenames[7]),
      `${canonical}\nSELECT ccpo_missing_refresh_token_function();\n`,
    );
    await expect(
      runMigrations({ databaseUrl: database.url, migrationsDirectory: directory }),
    ).rejects.toThrow(/failed to apply migration 0008/iu);
    const state = await schemaState(database.url);
    expect(state).toEqual({
      families: "auth_refresh_families",
      tokens: null,
      family_rows: "0",
      token_rows: "0",
    });
  });

  it("rejects checksum drift in an applied refresh migration", async () => {
    const database = await freshDatabase("ccpo_refresh_drift");
    const directory = await temporaryMigrationDirectory(migrationFilenames);
    await runMigrations({ databaseUrl: database.url, migrationsDirectory: directory });
    const path = join(directory, migrationFilenames[6]);
    await writeFile(path, `${await readFile(path, "utf8")}\n-- drift\n`);
    await expect(
      runMigrations({ databaseUrl: database.url, migrationsDirectory: directory }),
    ).rejects.toThrow(/checksum drift.*0007/iu);
  });
});
