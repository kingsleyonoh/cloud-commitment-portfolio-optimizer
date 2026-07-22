import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { runMigrations } from "../../core/db/migrations.js";

const adminDatabaseUrl = process.env.TEST_DATABASE_ADMIN_URL;
const databaseName = `ccpo_migrations_${process.pid}_${Date.now()}`;
let databaseUrl = "";
let migrationsDirectory = "";

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

beforeAll(async () => {
  if (!adminDatabaseUrl) {
    throw new Error(
      "TEST_DATABASE_ADMIN_URL is required; point it at an isolated local PostgreSQL 16 admin database.",
    );
  }

  const admin = new Client({ connectionString: adminDatabaseUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
  await admin.end();

  const parsed = new URL(adminDatabaseUrl);
  parsed.pathname = `/${databaseName}`;
  databaseUrl = parsed.toString();
  migrationsDirectory = await mkdtemp(join(tmpdir(), "ccpo-migration-integration-"));

  await writeFile(
    join(migrationsDirectory, "0001_create_probe.sql"),
    "CREATE TABLE migration_probe (id integer PRIMARY KEY);\n",
  );
  await writeFile(
    join(migrationsDirectory, "0002_extend_probe.sql"),
    "ALTER TABLE migration_probe ADD COLUMN label text NOT NULL DEFAULT 'ready';\n",
  );
});

afterAll(async () => {
  if (migrationsDirectory) await rm(migrationsDirectory, { recursive: true });
  if (!adminDatabaseUrl) return;

  const admin = new Client({ connectionString: adminDatabaseUrl });
  await admin.connect();
  await admin.query(
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
    [databaseName],
  );
  await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`);
  await admin.end();
});

it("applies migrations in order and reruns idempotently against a temporary database", async () => {
  const first = await runMigrations({ databaseUrl, migrationsDirectory });
  const second = await runMigrations({ databaseUrl, migrationsDirectory });

  expect(first).toEqual({
    applied: ["0001_create_probe.sql", "0002_extend_probe.sql"],
    skipped: [],
  });
  expect(second).toEqual({
    applied: [],
    skipped: ["0001_create_probe.sql", "0002_extend_probe.sql"],
  });

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const ledger = await client.query<{ version: string }>(
    "SELECT version FROM _ccpo_schema_migrations ORDER BY version",
  );
  const columns = await client.query<{ column_name: string }>(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'migration_probe' ORDER BY ordinal_position",
  );
  await client.end();

  expect(ledger.rows.map(({ version }) => version)).toEqual(["0001", "0002"]);
  expect(columns.rows.map(({ column_name }) => column_name)).toEqual(["id", "label"]);
});

it("fails closed when a newly discovered migration would be applied out of order", async () => {
  const lateFile = join(migrationsDirectory, "0000_late_history.sql");
  await writeFile(lateFile, "SELECT 0;\n");

  let failure: unknown;
  try {
    await runMigrations({ databaseUrl, migrationsDirectory });
  } catch (error) {
    failure = error;
  } finally {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query("DELETE FROM _ccpo_schema_migrations WHERE version = '0000'");
    await client.end();
    await rm(lateFile);
  }

  expect(failure).toBeInstanceOf(Error);
  expect((failure as Error).message).toMatch(/out.of.order.*0000/iu);
});

it("fails closed when an applied migration changes checksum", async () => {
  await writeFile(
    join(migrationsDirectory, "0002_extend_probe.sql"),
    "ALTER TABLE migration_probe ADD COLUMN changed text;\n",
  );

  await expect(runMigrations({ databaseUrl, migrationsDirectory })).rejects.toThrow(
    /checksum drift.*0002/iu,
  );
});

it("fails closed when an applied migration disappears from disk", async () => {
  await writeFile(
    join(migrationsDirectory, "0002_extend_probe.sql"),
    "ALTER TABLE migration_probe ADD COLUMN label text NOT NULL DEFAULT 'ready';\n",
  );
  await rm(join(migrationsDirectory, "0001_create_probe.sql"));

  await expect(runMigrations({ databaseUrl, migrationsDirectory })).rejects.toThrow(
    /applied migration.*0001.*missing/iu,
  );
});
