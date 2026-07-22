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
const migrations = [
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
const acceptedHashes: Record<string, string> = {
  "0001_create_tenants.sql": "d6ecd27b3f264c4bf8c0034697a6b21cb46c887beb26542d7958641cf30d5cba",
  "0002_create_users.sql": "07e669075706defc740198aab7d1eaf8c058f6d7e30832a1b26565b99f42e79e",
  "0003_create_api_keys.sql": "c9f239dcebed86629a07d29536c3fa9b22c5ca31da1158f0c0aafce2025f3b4d",
  "0004_create_registration_requests.sql":
    "c6612e110825c1c561f70cbf43b8e91c27047eec5ffd5e0af9294b601b6b0d42",
  "0005_create_audit_log.sql": "131ef18fa47ffd45a97e2ae5d7056aaa1b8fce4df2542ed20041d75be85a1160",
  "0006_create_user_auth_credentials.sql":
    "b44a0205508198ba95f845619ee9245adae58bd935e3980aa78309692109a489",
  "0007_create_auth_refresh_families.sql":
    "0ce44ddde7356e7bd10a99a358697659d3e8e5c3dd6150e95c52e680cb55c40a",
  "0008_create_auth_refresh_tokens.sql":
    "aa9373ec4dccff0c594de02b2bd0404990df17b9f4bf0321c2f3b24e3fcf9b60",
  "0009_create_cloud_accounts.sql":
    "fac094105a711724a6829b9e97c62c328344b3b1437dc348f279db551100cc22",
  "0010_create_import_batches.sql":
    "5794130c937ea3eed856cde8b50bc7a4b093be56081ba852ab248d12e184dc1a",
};
let databases: IsolatedDatabase[] = [];
let directories: string[] = [];

async function fresh(prefix: string): Promise<IsolatedDatabase> {
  const database = await createIsolatedDatabase(prefix);
  databases.push(database);
  return database;
}

async function plan(files: readonly string[]): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "ccpo-usage-migration-"));
  directories.push(directory);
  await Promise.all(
    files.map((file) => copyFile(join(migrationsDirectory, file), join(directory, file))),
  );
  return directory;
}

afterEach(async () => {
  await Promise.all(databases.map(dropIsolatedDatabase));
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true })));
  databases = [];
  directories = [];
});

describe("production usage line items migration runner and CLI", () => {
  it("preserves 0001-0010 and keeps 0011 additive, row-free, exact, and float-free", async () => {
    for (const [filename, expected] of Object.entries(acceptedHashes)) {
      const contents = await readFile(join(migrationsDirectory, filename));
      expect(createHash("sha256").update(contents).digest("hex"), filename).toBe(expected);
    }
    const sql = await readFile(join(migrationsDirectory, migrations[10]), "utf8");
    expect(sql).not.toMatch(/\bIF\s+NOT\s+EXISTS\b/iu);
    expect(sql).not.toMatch(/\bINSERT\s+INTO\b/iu);
    expect(sql).not.toMatch(/\b(REAL|DOUBLE\s+PRECISION|FLOAT)\b/iu);
    expect(sql).not.toMatch(
      /\b(updated_at|source_row_id|resource_id|operation|usage_type|currency|commitment_eligible|eligibility_reason|metadata|availability_zone|instance_family|instance_type|tenancy|platform)\b/iu,
    );
    const helper = await readFile(
      resolve("tests/integration/helpers/usage-line-items-schema.ts"),
      "utf8",
    );
    expect(helper).not.toMatch(/\bNumber\s*\(/u);
  });

  it("applies through 0013, re-applies unchanged, and reports zero rows", async () => {
    const database = await fresh("ccpo_usage_apply");
    const first = await runMigrations({ databaseUrl: database.url, migrationsDirectory });
    const second = await runMigrations({ databaseUrl: database.url, migrationsDirectory });
    const cli = await execFileAsync(
      process.execPath,
      [resolve("node_modules/tsx/dist/cli.mjs"), resolve("scripts/db-migrate.ts")],
      { cwd: resolve("."), env: { ...process.env, DATABASE_URL: database.url } },
    );
    const client = new Client({ connectionString: database.url });
    await client.connect();
    const count = await client.query<{ count: string }>("SELECT count(*) FROM usage_line_items");
    await client.end();
    expect(first).toEqual({ applied: [...migrations], skipped: [] });
    expect(second).toEqual({ applied: [], skipped: [...migrations] });
    expect(cli.stdout).toBe("Migrations complete: 0 applied, 15 unchanged.\n");
    expect(cli.stderr).toBe("");
    expect(count.rows[0]?.count).toBe("0");
  });

  it("uses the production CLI for a clean ordered apply", async () => {
    const database = await fresh("ccpo_usage_cli");
    const result = await execFileAsync(
      process.execPath,
      [resolve("node_modules/tsx/dist/cli.mjs"), resolve("scripts/db-migrate.ts")],
      { cwd: resolve("."), env: { ...process.env, DATABASE_URL: database.url } },
    );
    expect(result.stdout).toContain("Migrations complete: 15 applied, 0 unchanged.");
    expect(result.stdout).toContain("applied 0013_create_price_table_items.sql");
    expect(result.stderr).toBe("");
  });

  it("serializes concurrent clean applies with one receipt per version", async () => {
    const database = await fresh("ccpo_usage_concurrent");
    const results = await Promise.all([
      runMigrations({ databaseUrl: database.url, migrationsDirectory }),
      runMigrations({ databaseUrl: database.url, migrationsDirectory }),
    ]);
    const client = new Client({ connectionString: database.url });
    await client.connect();
    const receipts = await client.query<{ version: string; count: string }>(
      "SELECT version, count(*) FROM _ccpo_schema_migrations GROUP BY version ORDER BY version",
    );
    await client.end();
    expect(results).toContainEqual({ applied: [...migrations], skipped: [] });
    expect(results).toContainEqual({ applied: [], skipped: [...migrations] });
    expect(receipts.rows).toEqual(
      migrations.map((file) => ({ version: file.slice(0, 4), count: "1" })),
    );
  });

  it("rolls back failed 0011 support objects while preserving accepted 0010", async () => {
    const database = await fresh("ccpo_usage_rollback");
    const directory = await plan(migrations.slice(0, 10));
    await runMigrations({ databaseUrl: database.url, migrationsDirectory: directory });
    const sql = await readFile(join(migrationsDirectory, migrations[10]), "utf8");
    await writeFile(
      join(directory, migrations[10]),
      `${sql}\nSELECT ccpo_missing_usage_function();\n`,
    );
    await expect(
      runMigrations({ databaseUrl: database.url, migrationsDirectory: directory }),
    ).rejects.toThrow(/failed to apply migration 0011/iu);
    const client = new Client({ connectionString: database.url });
    await client.connect();
    const state = await client.query(`
      SELECT to_regclass('public.usage_line_items')::text AS usage_table,
             to_regclass('public.import_batches_tenant_id_id_key')::text AS support_index,
             to_regprocedure('public.reject_usage_line_item_mutation()')::text AS function_name,
             (SELECT count(*)::text FROM _ccpo_schema_migrations) AS receipts
    `);
    await client.end();
    expect(state.rows[0]).toEqual({
      usage_table: null,
      support_index: null,
      function_name: null,
      receipts: "10",
    });
  });

  it("rejects checksum drift in applied 0011", async () => {
    const database = await fresh("ccpo_usage_drift");
    const directory = await plan(migrations);
    await runMigrations({ databaseUrl: database.url, migrationsDirectory: directory });
    const path = join(directory, migrations[10]);
    await writeFile(path, `${await readFile(path, "utf8")}\n-- drift\n`);
    await expect(
      runMigrations({ databaseUrl: database.url, migrationsDirectory: directory }),
    ).rejects.toThrow(/checksum drift.*0011/iu);
  });
});
