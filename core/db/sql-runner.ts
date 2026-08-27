import { Client } from "pg";
import type { SqlFile, SqlPlanKind } from "./sql-plan.js";
import { type AppliedSqlFile, validateAppliedPlan } from "./sql-plan-validation.js";
import { finalizeSqlClient } from "./sql-runner-cleanup.js";

export { SchemaDriftError } from "./sql-plan-validation.js";

export interface SqlRunResult {
  applied: string[];
  skipped: string[];
}

const ledgerTables = {
  migration: "_ccpo_schema_migrations",
  setup: "_ccpo_setup_steps",
} as const satisfies Record<SqlPlanKind, string>;

export async function runSqlPlan(
  databaseUrl: string,
  kind: SqlPlanKind,
  files: readonly SqlFile[],
): Promise<SqlRunResult> {
  const ledgerTable = ledgerTables[kind];
  const lockName = `ccpo:${ledgerTable}`;
  const client = new Client({ connectionString: databaseUrl });
  let heldLock: string | undefined;
  let primaryFailure: unknown;
  try {
    await client.connect();
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [lockName]);
    heldLock = lockName;
    return await executeSqlPlan(client, kind, ledgerTable, files);
  } catch (error) {
    primaryFailure = error;
    throw error;
  } finally {
    await finalizeSqlClient(client, heldLock, primaryFailure);
  }
}

async function executeSqlPlan(
  client: Client,
  kind: SqlPlanKind,
  ledgerTable: string,
  files: readonly SqlFile[],
): Promise<SqlRunResult> {
  await createLedger(client, ledgerTable);
  const ledger = await client.query<AppliedSqlFile>(
    `SELECT version, filename, checksum FROM ${ledgerTable} ORDER BY version`,
  );
  const appliedByVersion = validateAppliedPlan(kind, files, ledger.rows);
  const result: SqlRunResult = { applied: [], skipped: [] };
  for (const file of files) {
    if (appliedByVersion.has(file.version)) result.skipped.push(file.filename);
    else await applySqlFile(client, kind, ledgerTable, file, result);
  }
  return result;
}

async function createLedger(client: Client, ledgerTable: string): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${ledgerTable} (
      version text PRIMARY KEY,
      filename text NOT NULL UNIQUE,
      checksum char(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function applySqlFile(
  client: Client,
  kind: SqlPlanKind,
  ledgerTable: string,
  file: SqlFile,
  result: SqlRunResult,
): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query(file.sql);
    await recordAppliedFile(client, ledgerTable, file);
    await client.query("COMMIT");
    result.applied.push(file.filename);
  } catch (error) {
    const primary = new Error(`Failed to apply ${kind} ${file.filename}: ${errorMessage(error)}`, {
      cause: error,
    });
    await rollbackAfterFailure(client, primary);
    throw primary;
  }
}

async function recordAppliedFile(client: Client, table: string, file: SqlFile): Promise<void> {
  await client.query(`INSERT INTO ${table} (version, filename, checksum) VALUES ($1, $2, $3)`, [
    file.version,
    file.filename,
    file.checksum,
  ]);
}

async function rollbackAfterFailure(client: Client, primary: Error): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch (error) {
    const cleanup = new Error(
      `Failed to roll back PostgreSQL transaction: ${errorMessage(error)}`,
      {
        cause: error,
      },
    );
    throw new AggregateError([primary, cleanup], "SQL file failed and rollback also failed.", {
      cause: primary,
    });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
