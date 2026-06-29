import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import pg from "pg";
import { loadConfigFromEnv } from "../core/shared/config.js";

const { Client } = pg;

export async function discoverSqlMigrations(
  migrationsDir: string,
): Promise<string[]> {
  try {
    const entries = await readdir(migrationsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
      .map((entry) => join(migrationsDir, entry.name))
      .sort();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function ensureMigrationTable(client: pg.Client): Promise<void> {
  await client.query(`
    create table if not exists schema_migrations (
      id text primary key,
      applied_at timestamptz not null default now()
    )
  `);
}

async function isMigrationApplied(
  client: pg.Client,
  id: string,
): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    "select exists(select 1 from schema_migrations where id = $1) as exists",
    [id],
  );
  return result.rows[0]?.exists ?? false;
}

async function applyMigration(
  client: pg.Client,
  filePath: string,
): Promise<void> {
  const id = filePath.split(/[\\/]/).at(-1) ?? filePath;
  if (await isMigrationApplied(client, id)) {
    return;
  }

  const sql = await readFile(filePath, "utf8");
  await client.query("begin");
  try {
    await client.query(sql);
    await client.query("insert into schema_migrations (id) values ($1)", [id]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

export async function runMigrations(
  migrationsDir = "db/migrations",
): Promise<number> {
  const migrations = await discoverSqlMigrations(migrationsDir);
  if (migrations.length === 0) {
    console.log(
      "No SQL migrations found; schema is at the bootstrap scaffold state.",
    );
    return 0;
  }

  const config = loadConfigFromEnv();
  const client = new Client({ connectionString: config.database.url });
  await client.connect();
  try {
    await ensureMigrationTable(client);
    for (const migration of migrations) {
      await applyMigration(client, migration);
    }
  } finally {
    await client.end();
  }

  console.log(`Applied ${migrations.length} migration file(s).`);
  return migrations.length;
}

function isDirectRun(): boolean {
  return resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  runMigrations().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
