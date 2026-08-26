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
  "0016_create_scenarios.sql",
  "0017_create_optimizer_policies.sql",
  "0018_create_optimizer_runs.sql",
  "0019_create_recommendations.sql",
  "0020_create_report_snapshots.sql",
  "0021_create_approvals.sql",
] as const;
const acceptedHashes: Record<string, string> = {
  "0001_create_tenants.sql": "f632eabead4e31d046f84656f0be6ece901d1c9447be81d40ed98303db3b24c5",
  "0002_create_users.sql": "9b18fe2ab934a0eb43f1f06e593b10711e1357e341b550704212cbec06b63111",
  "0003_create_api_keys.sql": "5e962937796270e3e2d39251a44f710d36333387d3ecdbdc905c2c71290675b4",
  "0004_create_registration_requests.sql":
    "11c4f978428704b567c74bff80a27b57011567ca3d9490e7319271325224185f",
  "0005_create_audit_log.sql": "4296a46de9f3fe8e904a285bfc4c0ef5e090d62582c4ad5c5eaba38ddfc6d3f8",
  "0006_create_user_auth_credentials.sql":
    "9338f956a35739cf501aea81012d2d65c40dc5b14378218fc51fd55281c2f122",
  "0007_create_auth_refresh_families.sql":
    "cda9fd4cf03282d3faf36623a7afcdb3a30e6215e9c34658eca38c176f05c77c",
  "0008_create_auth_refresh_tokens.sql":
    "6e2ca0231ccf9dd855411be23913cf2c25e2151e45b4be1f81dd5158708fbfbd",
  "0009_create_cloud_accounts.sql":
    "713136d8fd6bae27e52b297aa72de98152faeef7c35007aedc85a2d99dd6d9a1",
  "0010_create_import_batches.sql":
    "173062c2a265908a91439c92ef9465f09c992ebffa4f89c5f7005dfe4cf48584",
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

  it("applies through 0021, re-applies unchanged, and reports zero rows", async () => {
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
    expect(cli.stdout).toBe("Migrations complete: 0 applied, 21 unchanged.\n");
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
    expect(result.stdout).toContain("Migrations complete: 21 applied, 0 unchanged.");
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
