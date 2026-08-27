import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../core/db/migrations.js";
import {
  createIsolatedDatabase,
  dropIsolatedDatabase,
  type IsolatedDatabase,
} from "./helpers/postgres-database.js";

const migrationsDirectory = resolve("db/migrations");
const migrationFilenames = ["0001_create_tenants.sql", "0002_create_users.sql"] as const;
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
  const directory = await mkdtemp(join(tmpdir(), "ccpo-users-migration-"));
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

describe("production users migration runner", () => {
  it("applies in order, re-applies unchanged, and creates no rows", async () => {
    const database = await freshDatabase("ccpo_users_apply");
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
    const tenantRows = await client.query<{ count: string }>("SELECT count(*) FROM tenants");
    const userRows = await client.query<{ count: string }>("SELECT count(*) FROM users");
    await client.end();

    expect(first).toEqual({ applied: [...migrationFilenames], skipped: [] });
    expect(second).toEqual({ applied: [], skipped: [...migrationFilenames] });
    expect(receipts.rows.map(({ filename }) => filename)).toEqual([...migrationFilenames]);
    expect(tenantRows.rows[0]?.count).toBe("0");
    expect(userRows.rows[0]?.count).toBe("0");
  });

  it("serializes concurrent clean applies with one receipt per version", async () => {
    const database = await freshDatabase("ccpo_users_concurrent");
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
    ]);
  });

  it("rolls back failed 0002 without undoing 0001, then rejects 0002 drift", async () => {
    const database = await freshDatabase("ccpo_users_drift");
    const directory = await temporaryMigrationDirectory([migrationFilenames[0]]);
    await runMigrations({ databaseUrl: database.url, migrationsDirectory: directory });
    const usersPath = join(directory, migrationFilenames[1]);
    const canonicalSql = await readFile(join(migrationsDirectory, migrationFilenames[1]), "utf8");
    await writeFile(usersPath, `${canonicalSql}\nSELECT ccpo_missing_users_function();\n`);

    await expect(
      runMigrations({ databaseUrl: database.url, migrationsDirectory: directory }),
    ).rejects.toThrow(/failed to apply migration 0002/iu);
    const client = new Client({ connectionString: database.url });
    await client.connect();
    const rolledBack = await client.query<{ tenants: string | null; users: string | null }>(`
      SELECT to_regclass('public.tenants')::text AS tenants,
             to_regclass('public.users')::text AS users
    `);
    const receiptsBefore = await client.query<{ version: string }>(
      "SELECT version FROM _ccpo_schema_migrations ORDER BY version",
    );
    expect(rolledBack.rows[0]).toEqual({ tenants: "tenants", users: null });
    expect(receiptsBefore.rows).toEqual([{ version: "0001" }]);

    await writeFile(usersPath, canonicalSql);
    await runMigrations({ databaseUrl: database.url, migrationsDirectory: directory });
    await writeFile(usersPath, `${canonicalSql}\n-- drift\n`);
    await expect(
      runMigrations({ databaseUrl: database.url, migrationsDirectory: directory }),
    ).rejects.toThrow(/checksum drift.*0002/iu);
    const rows = await client.query<{ count: string }>("SELECT count(*) FROM users");
    const receiptsAfter = await client.query<{ version: string }>(
      "SELECT version FROM _ccpo_schema_migrations ORDER BY version",
    );
    await client.end();

    expect(rows.rows[0]?.count).toBe("0");
    expect(receiptsAfter.rows).toEqual([{ version: "0001" }, { version: "0002" }]);
  });
});
