import { resolve } from "node:path";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runMigrations } from "../../core/db/migrations.js";
import {
  createIsolatedDatabase,
  dropIsolatedDatabase,
  type IsolatedDatabase,
} from "./helpers/postgres-database.js";
import {
  insertUsageItem,
  insertUsageOwners,
  type UsageOwners,
} from "./helpers/usage-line-items-schema.js";

const migrationsDirectory = resolve("db/migrations");
let database: IsolatedDatabase | undefined;
let client: Client;
let tenantA: UsageOwners;
let tenantB: UsageOwners;

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_usage_line_items_behavior");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  client = new Client({ connectionString: database.url });
  await client.connect();
  tenantA = await insertUsageOwners(client, "usage-query-a");
  tenantB = await insertUsageOwners(client, "usage-query-b");
});

afterAll(async () => {
  if (client) await client.end();
  await dropIsolatedDatabase(database);
});

async function explain(sql: string, values: string[]): Promise<string> {
  const result = await client.query<{ "QUERY PLAN": string }>(`EXPLAIN (COSTS OFF) ${sql}`, values);
  return result.rows.map((row) => row["QUERY PLAN"]).join("\n");
}

describe("usage identity remains exact to PRD 4.5", () => {
  it("retains semantically duplicate rows under distinct primary identities", async () => {
    const first = await insertUsageItem(client, tenantA);
    const second = await insertUsageItem(client, tenantA);
    expect(first.rows[0]!.id).not.toBe(second.rows[0]!.id);
  });

  it("adds no source-row, deduplication, resource, currency, or eligibility schema", async () => {
    const result = await client.query(`
      SELECT
        (SELECT count(*)::text FROM pg_constraint
         WHERE conrelid = 'usage_line_items'::regclass AND contype = 'u') AS unique_non_primary,
        (SELECT count(*)::text FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'usage_line_items'
           AND column_name IN (
             'source_row_id', 'resource_id', 'operation', 'usage_type', 'currency',
             'commitment_eligible', 'eligibility_reason', 'metadata'
           )) AS speculative_columns
    `);
    expect(result.rows[0]).toEqual({ unique_non_primary: "0", speculative_columns: "0" });
  });
});

describe("three tenant-leading usage query plans", () => {
  it("uses the exact dimensions index", async () => {
    await insertUsageItem(client, tenantA);
    await client.query("SET enable_seqscan = off");
    try {
      const plan = await explain(
        `SELECT id FROM usage_line_items
         WHERE tenant_id = $1 AND provider = 'aws' AND service_code = 'AmazonEC2'
           AND region = 'us-east-1' AND usage_start >= '2026-01-01T00:00:00Z'
         ORDER BY usage_start`,
        [tenantA.tenantId],
      );
      expect(plan).toContain("usage_line_items_tenant_usage_dimensions_idx");
    } finally {
      await client.query("RESET enable_seqscan");
    }
  });

  it("uses the exact account index", async () => {
    await insertUsageItem(client, tenantA);
    await client.query("SET enable_seqscan = off");
    try {
      const plan = await explain(
        `SELECT id FROM usage_line_items
         WHERE tenant_id = $1 AND cloud_account_id = $2 ORDER BY usage_start`,
        [tenantA.tenantId, tenantA.accountId],
      );
      expect(plan).toContain("usage_line_items_tenant_account_usage_start_idx");
    } finally {
      await client.query("RESET enable_seqscan");
    }
  });

  it("uses the exact import-batch index and excludes another tenant", async () => {
    const rowA = (await insertUsageItem(client, tenantA)).rows[0]!.id;
    await insertUsageItem(client, tenantB);
    await client.query("SET enable_seqscan = off");
    try {
      const plan = await explain(
        "SELECT id FROM usage_line_items WHERE tenant_id = $1 AND import_batch_id = $2",
        [tenantA.tenantId, tenantA.batchId],
      );
      const rows = await client.query<{ id: string }>(
        "SELECT id FROM usage_line_items WHERE tenant_id = $1 AND id = $2",
        [tenantA.tenantId, rowA],
      );
      expect(plan).toContain("usage_line_items_tenant_import_batch_idx");
      expect(rows.rows).toEqual([{ id: rowA }]);
    } finally {
      await client.query("RESET enable_seqscan");
    }
  });
});
