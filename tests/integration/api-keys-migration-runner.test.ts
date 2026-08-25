import { execFile } from "node:child_process";
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
] as const;
const migrationVersions = ["0001", "0002", "0003"] as const;
let databases: IsolatedDatabase[] = [];
let temporaryDirectories: string[] = [];

async function freshDatabase(prefix: string): Promise<IsolatedDatabase> {
  const database = await createIsolatedDatabase(prefix);
  databases.push(database);
  return database;
}

async function temporaryMigrationDirectory(
  files: readonly string[] = migrationFilenames,
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "ccpo-api-keys-migration-"));
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
  const result = await client.query<{ tenants: string; users: string; api_keys: string }>(`
    SELECT (SELECT count(*) FROM tenants)::text AS tenants,
           (SELECT count(*) FROM users)::text AS users,
           (SELECT count(*) FROM api_keys)::text AS api_keys
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

describe("production API-keys migration runner and CLI", () => {
  it("applies isolated 0001-0003 in order, re-applies unchanged, and creates zero rows", async () => {
    const database = await freshDatabase("ccpo_api_keys_apply");
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
    await client.end();

    expect(first).toEqual({ applied: [...migrationFilenames], skipped: [] });
    expect(second).toEqual({ applied: [], skipped: [...migrationFilenames] });
    expect(receipts.rows.map(({ filename }) => filename)).toEqual([...migrationFilenames]);
    expect(await readCounts(database.url)).toEqual({ tenants: "0", users: "0", api_keys: "0" });
  });

  it("uses the production CLI for an apply and unchanged reapply", async () => {
    const database = await freshDatabase("ccpo_api_keys_cli");
    const tsxCli = resolve("node_modules/tsx/dist/cli.mjs");
    const command = [tsxCli, resolve("scripts/db-migrate.ts")];
    const options = {
      cwd: resolve("."),
      env: { ...process.env, DATABASE_URL: database.url },
    };
    const first = await execFileAsync(process.execPath, command, options);
    const second = await execFileAsync(process.execPath, command, options);

    expect(first.stdout).toContain("Migrations complete: 20 applied, 0 unchanged.");
    expect(first.stdout).toContain("applied 0013_create_price_table_items.sql");
    expect(second.stdout).toContain("Migrations complete: 0 applied, 20 unchanged.");
    expect(first.stderr).toBe("");
    expect(second.stderr).toBe("");
    expect(await readCounts(database.url)).toEqual({ tenants: "0", users: "0", api_keys: "0" });
  });

  it("serializes concurrent clean 0001-0003 applies with one receipt per version", async () => {
    const database = await freshDatabase("ccpo_api_keys_concurrent");
    const directory = await temporaryMigrationDirectory();
    const results = await Promise.all([
      runMigrations({ databaseUrl: database.url, migrationsDirectory: directory }),
      runMigrations({ databaseUrl: database.url, migrationsDirectory: directory }),
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
    expect(receipts.rows).toEqual([
      { version: "0001", count: "1" },
      { version: "0002", count: "1" },
      { version: "0003", count: "1" },
    ]);
  });

  it("rolls back failed 0003, preserves 0001-0002, then rejects 0003 drift", async () => {
    const database = await freshDatabase("ccpo_api_keys_drift");
    const directory = await temporaryMigrationDirectory(migrationFilenames.slice(0, 2));
    await runMigrations({ databaseUrl: database.url, migrationsDirectory: directory });
    const apiKeysPath = join(directory, migrationFilenames[2]);
    const canonicalSql = await readFile(join(migrationsDirectory, migrationFilenames[2]), "utf8");
    await writeFile(apiKeysPath, `${canonicalSql}\nSELECT ccpo_missing_api_keys_function();\n`);

    await expect(
      runMigrations({ databaseUrl: database.url, migrationsDirectory: directory }),
    ).rejects.toThrow(/failed to apply migration 0003/iu);
    const client = new Client({ connectionString: database.url });
    await client.connect();
    const rolledBack = await client.query<{ api_keys: string | null }>(
      "SELECT to_regclass('public.api_keys')::text AS api_keys",
    );
    const receiptsBefore = await client.query<{ version: string }>(
      "SELECT version FROM _ccpo_schema_migrations ORDER BY version",
    );
    expect(rolledBack.rows[0]?.api_keys).toBeNull();
    expect(receiptsBefore.rows).toEqual([{ version: "0001" }, { version: "0002" }]);

    await writeFile(apiKeysPath, canonicalSql);
    await runMigrations({ databaseUrl: database.url, migrationsDirectory: directory });
    await writeFile(apiKeysPath, `${canonicalSql}\n-- drift\n`);
    await expect(
      runMigrations({ databaseUrl: database.url, migrationsDirectory: directory }),
    ).rejects.toThrow(/checksum drift.*0003/iu);
    const receiptsAfter = await client.query<{ version: string }>(
      "SELECT version FROM _ccpo_schema_migrations ORDER BY version",
    );
    const rows = await client.query<{ count: string }>("SELECT count(*) FROM api_keys");
    await client.end();

    expect(receiptsAfter.rows).toEqual(migrationVersions.map((version) => ({ version })));
    expect(rows.rows[0]?.count).toBe("0");
  });
});
