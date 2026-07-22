import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runSqlPlan } from "../../core/db/sql-runner.js";
import type { SqlFile } from "../../core/db/sql-plan.js";

const adminDatabaseUrl = process.env.TEST_DATABASE_ADMIN_URL;
const databaseName = `ccpo_cleanup_${process.pid}_${Date.now()}`;
let databaseUrl = "";

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function withAdmin(action: (client: Client) => Promise<void>): Promise<void> {
  if (!adminDatabaseUrl) throw new Error("TEST_DATABASE_ADMIN_URL is required.");
  const client = new Client({ connectionString: adminDatabaseUrl });
  await client.connect();
  try {
    await action(client);
  } finally {
    await client.end();
  }
}

beforeAll(async () => {
  await withAdmin(async (admin) => {
    await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
  });
  const parsed = new URL(adminDatabaseUrl!);
  parsed.pathname = `/${databaseName}`;
  databaseUrl = parsed.toString();
});

afterAll(async () => {
  if (!adminDatabaseUrl) return;
  await withAdmin(async (admin) => {
    await admin.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [databaseName],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`);
  });
});

function cleanupFailurePlan(): SqlFile[] {
  const unlockFailure = [
    "CREATE FUNCTION public.pg_advisory_unlock(bigint) RETURNS boolean",
    "LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'unlock probe failure'; END $$;",
    "SET search_path TO public, pg_catalog;",
  ].join(" ");
  return [
    sqlFile("0001", "install_unlock_probe", unlockFailure),
    sqlFile("0002", "primary_failure", "SELECT * FROM missing_primary_probe;"),
  ];
}

function sqlFile(version: string, name: string, sql: string): SqlFile {
  return {
    version,
    name,
    filename: `${version}_${name}.sql`,
    path: "live-postgresql-probe",
    checksum: version.repeat(64).slice(0, 64),
    sql,
  };
}

function errorText(error: unknown): string {
  if (!(error instanceof AggregateError)) return String(error);
  return [error.message, ...error.errors.map(errorText)].join(" | ");
}

describe("PostgreSQL SQL runner cleanup", () => {
  it("preserves the primary failure and observes advisory unlock cleanup failure", async () => {
    let failure: unknown;
    try {
      await runSqlPlan(databaseUrl, "migration", cleanupFailurePlan());
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).cause).toBeDefined();
    expect(errorText(failure)).toMatch(/missing_primary_probe/iu);
    expect(errorText(failure)).toMatch(/advisory unlock|release PostgreSQL advisory lock/iu);
  });
});
