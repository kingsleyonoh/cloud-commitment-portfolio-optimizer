import { Client } from "pg";
import type { Logger } from "../../core/shared/logger.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../apps/api/app.js";
import { createAppDbPoolResource, type DbPoolResource } from "../../core/shared/db.js";

const adminDatabaseUrl = process.env.TEST_DATABASE_ADMIN_URL;
const databaseName = `ccpo_health_${process.pid}_${Date.now()}`;
let databaseUrl = "";
let database: DbPoolResource;

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function logger(): Logger {
  const value: Logger = {
    debug: async () => undefined,
    info: async () => undefined,
    warn: async () => undefined,
    error: async () => undefined,
    child: () => value,
    flush: async () => undefined,
    close: async () => undefined,
  };
  return value;
}

beforeAll(async () => {
  if (!adminDatabaseUrl) {
    throw new Error("TEST_DATABASE_ADMIN_URL is required for isolated PostgreSQL health tests.");
  }
  const admin = new Client({ connectionString: adminDatabaseUrl });
  await admin.connect();
  try {
    const version = await admin.query<{ server_version: string }>("SHOW server_version");
    expect(version.rows[0]?.server_version).toMatch(/^16\./u);
    await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
  } finally {
    await admin.end();
  }
  const parsed = new URL(adminDatabaseUrl);
  parsed.pathname = `/${databaseName}`;
  databaseUrl = parsed.toString();
  database = createAppDbPoolResource({
    url: databaseUrl,
    localPort: parsed.port ? Number(parsed.port) : 5432,
    pool: { max: 2, idleTimeoutMillis: 1000, connectionTimeoutMillis: 2000 },
  });
});

afterAll(async () => {
  await database?.close();
  if (!adminDatabaseUrl) return;
  const admin = new Client({ connectionString: adminDatabaseUrl });
  await admin.connect();
  try {
    await admin.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [databaseName],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`);
  } finally {
    await admin.end();
  }
});

describe("live PostgreSQL health route", () => {
  it("reuses one managed application pool for repeated real SELECT 1 probes", async () => {
    const app = buildApp({
      logger: logger(),
      genReqId: () => "live-db-request",
      databaseProbe: () => database.health(),
      databaseTimeoutMs: 2000,
    });

    const [first, second] = await Promise.all([
      app.inject({ method: "GET", url: "/health/db" }),
      app.inject({ method: "GET", url: "/health/db" }),
    ]);

    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ status: "ok" });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ status: "ok" });
    expect(database.pool.totalCount).toBeLessThanOrEqual(2);
    await app.close();
  });
});
