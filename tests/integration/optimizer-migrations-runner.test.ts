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
  "0011_create_usage_line_items.sql":
    "2ffcef0a7d600bc9c1b746d289010efd992a2ee516cdf8eea2348d3eed4d658d",
  "0012_create_price_table_versions.sql":
    "fc42985b4f99588924dbaae09885e416e73b3bd85f9968605da9627e4b9894b6",
  "0013_create_price_table_items.sql":
    "db6d9804b5903360a68e9a24ea85ff3259d09d7176ecfbdab6f55a78f83df108",
  "0014_create_forecast_models.sql":
    "f89365114c6bbf0845dd9da85d2733e5c5b610b407e517c3748d35e5e61407ac",
  "0015_create_forecast_runs.sql":
    "a4020341ea0126796c734732d90587662bf7c0537a5ecbb85e0700d9697ae1b8",
};
let databases: IsolatedDatabase[] = [];
let directories: string[] = [];

async function fresh(prefix: string): Promise<IsolatedDatabase> {
  const database = await createIsolatedDatabase(prefix);
  databases.push(database);
  return database;
}

async function plan(files: readonly string[]): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "ccpo-optimizer-migration-"));
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

describe("production optimizer migration runner and CLI", () => {
  it("preserves 0001-0015 and keeps optimizer migrations additive and row-free", async () => {
    for (const [filename, expected] of Object.entries(acceptedHashes)) {
      const contents = await readFile(join(migrationsDirectory, filename));
      expect(createHash("sha256").update(contents).digest("hex"), filename).toBe(expected);
    }
    for (const filename of migrations.slice(15)) {
      const sql = await readFile(join(migrationsDirectory, filename), "utf8");
      expect(sql).not.toMatch(/\bIF\s+NOT\s+EXISTS\b/iu);
      expect(sql).not.toMatch(/\bINSERT\s+INTO\b/iu);
      expect(sql).not.toMatch(/\b(REAL|DOUBLE\s+PRECISION|FLOAT)\b/iu);
    }
  });

  it("applies through optimizer data tables, reapplies unchanged, and creates zero rows", async () => {
    const database = await fresh("ccpo_optimizer_apply");
    const first = await runMigrations({ databaseUrl: database.url, migrationsDirectory });
    const second = await runMigrations({ databaseUrl: database.url, migrationsDirectory });
    const client = new Client({ connectionString: database.url });
    await client.connect();
    const count = await client.query(`
      SELECT (SELECT count(*)::text FROM optimizer_policies) AS policies,
             (SELECT count(*)::text FROM optimizer_runs) AS runs,
             (SELECT count(*)::text FROM recommendations) AS recommendations
    `);
    await client.end();
    expect(first).toEqual({ applied: [...migrations], skipped: [] });
    expect(second).toEqual({ applied: [], skipped: [...migrations] });
    expect(count.rows[0]).toEqual({ policies: "0", runs: "0", recommendations: "0" });
  });

  it("uses the production CLI for a clean ordered apply", async () => {
    const database = await fresh("ccpo_optimizer_cli");
    const result = await execFileAsync(
      process.execPath,
      [resolve("node_modules/tsx/dist/cli.mjs"), resolve("scripts/db-migrate.ts")],
      { cwd: resolve("."), env: { ...process.env, DATABASE_URL: database.url } },
    );
    expect(result.stdout).toContain("Migrations complete: 21 applied, 0 unchanged.");
    expect(result.stdout).toContain("applied 0019_create_recommendations.sql");
    expect(result.stderr).toBe("");
  });

  it.each([15, 16, 17, 18])(
    "rolls back failed migration index %s and rejects drift",
    async (index) => {
      const database = await fresh(`ccpo_optimizer_rollback_${index}`);
      const directory = await plan(migrations.slice(0, index));
      await runMigrations({ databaseUrl: database.url, migrationsDirectory: directory });
      const filename = migrations[index]!;
      const sql = await readFile(join(migrationsDirectory, filename), "utf8");
      await writeFile(
        join(directory, filename),
        `${sql}\nSELECT ccpo_missing_optimizer_object();\n`,
      );
      await expect(
        runMigrations({ databaseUrl: database.url, migrationsDirectory: directory }),
      ).rejects.toThrow(new RegExp(`failed to apply migration ${filename.slice(0, 4)}`, "iu"));
      const cleanDirectory = await plan(migrations.slice(0, index + 1));
      await runMigrations({ databaseUrl: database.url, migrationsDirectory: cleanDirectory });
      const path = join(cleanDirectory, filename);
      await writeFile(path, `${await readFile(path, "utf8")}\n-- drift\n`);
      await expect(
        runMigrations({ databaseUrl: database.url, migrationsDirectory: cleanDirectory }),
      ).rejects.toThrow(new RegExp(`checksum drift.*${filename.slice(0, 4)}`, "iu"));
    },
  );
});
