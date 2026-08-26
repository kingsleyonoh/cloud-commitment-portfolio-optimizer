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
  "0016_create_scenarios.sql",
  "0017_create_optimizer_policies.sql",
  "0018_create_optimizer_runs.sql",
  "0019_create_recommendations.sql",
  "0020_create_report_snapshots.sql",
  "0021_create_approvals.sql",
  "0022_create_backtest_runs.sql",
] as const;
const acceptedHashes = {
  "0001_create_tenants.sql": "f632eabead4e31d046f84656f0be6ece901d1c9447be81d40ed98303db3b24c5",
  "0002_create_users.sql": "9b18fe2ab934a0eb43f1f06e593b10711e1357e341b550704212cbec06b63111",
  "0003_create_api_keys.sql": "5e962937796270e3e2d39251a44f710d36333387d3ecdbdc905c2c71290675b4",
  "0004_create_registration_requests.sql":
    "11c4f978428704b567c74bff80a27b57011567ca3d9490e7319271325224185f",
} as const;
let databases: IsolatedDatabase[] = [];
let temporaryDirectories: string[] = [];

async function freshDatabase(prefix: string): Promise<IsolatedDatabase> {
  const database = await createIsolatedDatabase(prefix);
  databases.push(database);
  return database;
}

async function temporaryMigrationDirectory(files: readonly string[]): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "ccpo-audit-migration-"));
  temporaryDirectories.push(directory);
  await Promise.all(
    files.map((filename) =>
      copyFile(join(migrationsDirectory, filename), join(directory, filename)),
    ),
  );
  return directory;
}

afterEach(async () => {
  await Promise.all(databases.map((database) => dropIsolatedDatabase(database)));
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true })));
  databases = [];
  temporaryDirectories = [];
});

describe("production audit-log migration runner and CLI", () => {
  it("preserves accepted 0001-0004 bytes and keeps 0005 declarative and row-free", async () => {
    for (const [filename, expected] of Object.entries(acceptedHashes)) {
      const contents = await readFile(join(migrationsDirectory, filename));
      expect(createHash("sha256").update(contents).digest("hex"), filename).toBe(expected);
    }
    const auditSql = await readFile(join(migrationsDirectory, migrationFilenames[4]), "utf8");
    expect(auditSql).not.toMatch(/\bIF\s+NOT\s+EXISTS\b/iu);
    expect(auditSql).not.toMatch(/\bINSERT\s+INTO\b/iu);
    expect(auditSql).not.toMatch(/\breport_snapshots\b|\bapi_keys\b/iu);
  });

  it("applies the current plan through 0022 and re-applies unchanged", async () => {
    const database = await freshDatabase("ccpo_audit_apply");
    const first = await runMigrations({ databaseUrl: database.url, migrationsDirectory });
    const second = await runMigrations({ databaseUrl: database.url, migrationsDirectory });
    const command = [resolve("node_modules/tsx/dist/cli.mjs"), resolve("scripts/db-migrate.ts")];
    const options = { cwd: resolve("."), env: { ...process.env, DATABASE_URL: database.url } };
    const cli = await execFileAsync(process.execPath, command, options);
    const client = new Client({ connectionString: database.url });
    await client.connect();
    const receipts = await client.query<{ filename: string }>(
      "SELECT filename FROM _ccpo_schema_migrations ORDER BY version",
    );
    const rows = await client.query<{ count: string }>("SELECT count(*) FROM audit_log");
    await client.end();

    expect(first).toEqual({ applied: [...allMigrationFilenames], skipped: [] });
    expect(second).toEqual({ applied: [], skipped: [...allMigrationFilenames] });
    expect(receipts.rows.map(({ filename }) => filename)).toEqual([...allMigrationFilenames]);
    expect(cli.stdout).toContain("Migrations complete: 0 applied, 22 unchanged.");
    expect(cli.stderr).toBe("");
    expect(rows.rows[0]?.count).toBe("0");
  });

  it("uses the production CLI for a clean current-plan apply", async () => {
    const database = await freshDatabase("ccpo_audit_cli");
    const command = [resolve("node_modules/tsx/dist/cli.mjs"), resolve("scripts/db-migrate.ts")];
    const result = await execFileAsync(process.execPath, command, {
      cwd: resolve("."),
      env: { ...process.env, DATABASE_URL: database.url },
    });
    expect(result.stdout).toContain("Migrations complete: 22 applied, 0 unchanged.");
    expect(result.stdout).toContain("applied 0013_create_price_table_items.sql");
    expect(result.stderr).toBe("");
  });

  it("serializes concurrent clean applies with one receipt per version", async () => {
    const database = await freshDatabase("ccpo_audit_concurrent");
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

  it("rolls back failed 0005 while preserving 0001-0004", async () => {
    const database = await freshDatabase("ccpo_audit_rollback");
    const directory = await temporaryMigrationDirectory(migrationFilenames.slice(0, 4));
    await runMigrations({ databaseUrl: database.url, migrationsDirectory: directory });
    const migrationPath = join(directory, migrationFilenames[4]);
    const canonicalSql = await readFile(join(migrationsDirectory, migrationFilenames[4]), "utf8");
    await writeFile(migrationPath, `${canonicalSql}\nSELECT ccpo_missing_audit_function();\n`);
    await expect(
      runMigrations({ databaseUrl: database.url, migrationsDirectory: directory }),
    ).rejects.toThrow(/failed to apply migration 0005/iu);

    const client = new Client({ connectionString: database.url });
    await client.connect();
    const rolledBack = await client.query<{
      audit_log: string | null;
      support_index: string | null;
      reject_function: string | null;
    }>(`
      SELECT to_regclass('public.audit_log')::text AS audit_log,
             to_regclass('public.users_tenant_id_id_key')::text AS support_index,
             to_regprocedure('public.reject_audit_log_mutation()')::text AS reject_function
    `);
    const receipts = await client.query<{ version: string }>(
      "SELECT version FROM _ccpo_schema_migrations ORDER BY version",
    );
    await client.end();
    expect(rolledBack.rows[0]).toEqual({
      audit_log: null,
      support_index: null,
      reject_function: null,
    });
    expect(receipts.rows.map(({ version }) => version)).toEqual(["0001", "0002", "0003", "0004"]);
  });

  it("rejects checksum drift after a successful 0005 apply", async () => {
    const database = await freshDatabase("ccpo_audit_drift");
    const directory = await temporaryMigrationDirectory(migrationFilenames);
    await runMigrations({ databaseUrl: database.url, migrationsDirectory: directory });
    const migrationPath = join(directory, migrationFilenames[4]);
    const canonicalSql = await readFile(migrationPath, "utf8");
    await writeFile(migrationPath, `${canonicalSql}\n-- drift\n`);
    await expect(
      runMigrations({ databaseUrl: database.url, migrationsDirectory: directory }),
    ).rejects.toThrow(/checksum drift.*0005/iu);

    const client = new Client({ connectionString: database.url });
    await client.connect();
    const receipts = await client.query<{ version: string }>(
      "SELECT version FROM _ccpo_schema_migrations ORDER BY version",
    );
    const rows = await client.query<{ count: string }>("SELECT count(*) FROM audit_log");
    await client.end();
    expect(receipts.rows.map(({ version }) => version)).toEqual([
      "0001",
      "0002",
      "0003",
      "0004",
      "0005",
    ]);
    expect(rows.rows[0]?.count).toBe("0");
  });
});
