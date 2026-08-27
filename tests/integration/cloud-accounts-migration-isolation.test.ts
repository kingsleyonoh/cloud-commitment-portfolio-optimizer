import { resolve } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../core/db/migrations.js";
import {
  createIsolatedDatabase,
  dropIsolatedDatabase,
  type IsolatedDatabase,
} from "./helpers/postgres-database.js";

const migrationsDirectory = resolve("db/migrations");
let database: IsolatedDatabase | undefined;
let client: Client;

async function insertTenant(label: string): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO tenants (name, legal_name, full_legal_name, display_name)
     VALUES ($1, $1, $1, $1) RETURNING id`,
    [label],
  );
  return result.rows[0]!.id;
}

async function insertAccount(tenantId: string, externalRef: string, displayName: string) {
  return client.query<{ id: string; created_at: Date; updated_at: Date }>(
    `INSERT INTO cloud_accounts
       (tenant_id, provider, external_ref, display_name, currency, tags)
     VALUES ($1, 'aws', $2, $3, 'USD', '{"source":"synthetic"}'::jsonb)
     RETURNING id, created_at, updated_at`,
    [tenantId, externalRef, displayName],
  );
}

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_cloud_accounts_isolation");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  client = new Client({ connectionString: database.url });
  await client.connect();
});

afterAll(async () => {
  if (client) await client.end();
  await dropIsolatedDatabase(database);
});

describe("tenant-leading cloud account isolation", () => {
  it("uses the tenant/provider/active index and excludes every other tenant literal", async () => {
    const tenantA = await insertTenant("Account query tenant A");
    const tenantB = await insertTenant("Account query tenant B");
    const accountA = await insertAccount(
      tenantA,
      "synthetic-query-account-a",
      "Synthetic tenant A account",
    );
    await insertAccount(tenantB, "synthetic-query-account-b", "Synthetic tenant B account");
    await client.query("SET enable_seqscan = off");
    const plan = await client.query<{ "QUERY PLAN": string }>(
      `EXPLAIN (COSTS OFF)
       SELECT id, external_ref, display_name FROM cloud_accounts
       WHERE tenant_id = $1 AND provider = 'aws'
       ORDER BY is_active`,
      [tenantA],
    );
    const rows = await client.query<{ id: string; external_ref: string; display_name: string }>(
      `SELECT id, external_ref, display_name FROM cloud_accounts
       WHERE tenant_id = $1 AND provider = 'aws' AND is_active = true
       ORDER BY external_ref, id`,
      [tenantA],
    );
    await client.query("RESET enable_seqscan");
    expect(plan.rows.map((row) => row["QUERY PLAN"]).join("\n")).toContain(
      "cloud_accounts_tenant_provider_active_idx",
    );
    expect(rows.rows).toEqual([
      {
        id: accountA.rows[0]!.id,
        external_ref: "synthetic-query-account-a",
        display_name: "Synthetic tenant A account",
      },
    ]);
    expect(JSON.stringify(rows.rows)).not.toContain("Synthetic tenant B account");
  });
});

describe("database-managed cloud account timestamps", () => {
  it("advances updated_at on metadata/status updates while preserving created_at", async () => {
    const tenantId = await insertTenant("Account timestamp tenant");
    const before = (await insertAccount(tenantId, "synthetic-timestamp-account", "Before update"))
      .rows[0]!;
    await client.query("SELECT pg_sleep(0.02)");
    const updated = await client.query<{
      created_at: Date;
      updated_at: Date;
      display_name: string;
      is_active: boolean;
    }>(
      `UPDATE cloud_accounts
       SET display_name = 'After update', is_active = false,
           updated_at = '2000-01-01T00:00:00Z'
       WHERE tenant_id = $1 AND id = $2
       RETURNING created_at, updated_at, display_name, is_active`,
      [tenantId, before.id],
    );
    expect(updated.rows[0]).toMatchObject({
      created_at: before.created_at,
      display_name: "After update",
      is_active: false,
    });
    expect(updated.rows[0]!.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
  });
});
