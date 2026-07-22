import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createAppDbPoolResource,
  createDbPoolCache,
  createPgDbPoolResource,
  type DbPoolResource,
} from "../../core/shared/db.js";

const adminDatabaseUrl = process.env.TEST_DATABASE_ADMIN_URL;
const databaseName = `ccpo_pool_${process.pid}_${Date.now()}`;
let databaseUrl = "";

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
});

afterAll(async () => {
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

function createConfiguredCache(onCreate: () => void) {
  return createDbPoolCache(async () => {
    onCreate();
    return createAppDbPoolResource({
      url: databaseUrl,
      localPort: 5432,
      pool: { max: 2, idleTimeoutMillis: 1000, connectionTimeoutMillis: 2000 },
    });
  });
}

function assertConfiguredPool(resource: DbPoolResource): void {
  expect(resource.pool.options.max).toBe(2);
  expect(resource.pool.options.idleTimeoutMillis).toBe(1000);
  expect(resource.pool.options.connectionTimeoutMillis).toBe(2000);
}

function registerPoolLifecycleTest(): void {
  it("coalesces concurrent acquisition, executes real health, and reacquires after close", async () => {
    let creations = 0;
    const cache = createConfiguredCache(() => {
      creations += 1;
    });

    const [first, second] = await Promise.all([cache.get(), cache.get()]);
    expect(first).toBe(second);
    await expect(first.health()).resolves.toEqual({ ready: true });
    await expect(first.pool.query<{ probe: number }>("SELECT 1 AS probe")).resolves.toMatchObject({
      rows: [{ probe: 1 }],
    });
    assertConfiguredPool(first);
    await Promise.all([cache.close(), cache.close()]);

    const reopened = await cache.get();
    expect(reopened).not.toBe(first);
    await expect(reopened.health()).resolves.toEqual({ ready: true });
    expect(creations).toBe(2);
    await cache.close();
  });
}

function registerPoolFailureTest(): void {
  it("rejects a real connection failure rather than reporting ready", async () => {
    const unreachable = createPgDbPoolResource({
      connectionString: "postgresql://127.0.0.1:1/ccpo",
      connectionTimeoutMillis: 250,
    });

    await expect(unreachable.health()).rejects.toBeInstanceOf(Error);
    await unreachable.close();
  });
}

describe("application PostgreSQL pool", () => {
  registerPoolLifecycleTest();
  registerPoolFailureTest();
});
