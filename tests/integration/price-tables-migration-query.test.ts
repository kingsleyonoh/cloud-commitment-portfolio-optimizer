import { createHash } from "node:crypto";
import { resolve } from "node:path";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runMigrations } from "../../core/db/migrations.js";
import {
  insertPriceItem,
  insertPriceTenant,
  insertPriceVersion,
} from "./helpers/price-tables-schema.js";
import {
  createIsolatedDatabase,
  dropIsolatedDatabase,
  type IsolatedDatabase,
} from "./helpers/postgres-database.js";

const migrationsDirectory = resolve("db/migrations");
let database: IsolatedDatabase | undefined;
let client: Client;
let tenantA: string;
let tenantB: string;
let versionA: string;

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_price_tables_query");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  client = new Client({ connectionString: database.url });
  await client.connect();
  tenantA = await insertPriceTenant(client, "price query tenant a");
  tenantB = await insertPriceTenant(client, "price query tenant b");
  versionA = (
    await insertPriceVersion(client, tenantA, {
      versionLabel: "query-a",
      checksum: createHash("sha256").update("query-a").digest("hex"),
    })
  ).rows[0]!.id;
  const versionB = (
    await insertPriceVersion(client, tenantB, {
      versionLabel: "query-b",
      checksum: createHash("sha256").update("query-b").digest("hex"),
    })
  ).rows[0]!.id;
  await insertPriceItem(client, tenantA, versionA);
  await insertPriceItem(client, tenantB, versionB);
});

afterAll(async () => {
  if (client) await client.end();
  await dropIsolatedDatabase(database);
});

async function explain(sql: string, values: string[]): Promise<string> {
  const result = await client.query<{ "QUERY PLAN": string }>(`EXPLAIN (COSTS OFF) ${sql}`, values);
  return result.rows.map((row) => row["QUERY PLAN"]).join("\n");
}

describe("tenant-leading price lookup plans", () => {
  it("uses the canonical version status/effective lookup index", async () => {
    await client.query("SET enable_seqscan = off");
    try {
      const plan = await explain(
        `SELECT id FROM price_table_versions
         WHERE tenant_id = $1 AND provider = 'aws'
           AND instrument = 'aws_compute_savings_plan' AND status = 'draft'
           AND effective_from <= '2026-01-01' ORDER BY effective_from DESC`,
        [tenantA],
      );
      expect(plan).toContain("price_table_versions_tenant_lookup_idx");
    } finally {
      await client.query("RESET enable_seqscan");
    }
  });

  it("uses the canonical version/SKU/region item lookup index", async () => {
    await client.query("SET enable_seqscan = off");
    try {
      const plan = await explain(
        `SELECT id FROM price_table_items
         WHERE tenant_id = $1 AND price_table_version_id = $2
           AND sku >= 'synthetic-compute' AND region = 'test-region-1'
         ORDER BY sku, region`,
        [tenantA, versionA],
      );
      expect(plan).toContain("price_table_items_tenant_version_sku_region_idx");
    } finally {
      await client.query("RESET enable_seqscan");
    }
  });

  it("uses the canonical provider/instrument/term dimensions index", async () => {
    await client.query("SET enable_seqscan = off");
    try {
      const plan = await explain(
        `SELECT id FROM price_table_items
         WHERE tenant_id = $1 AND provider = 'aws'
           AND instrument = 'aws_compute_savings_plan' AND term_months = 12`,
        [tenantA],
      );
      expect(plan).toContain("price_table_items_tenant_dimensions_idx");
    } finally {
      await client.query("RESET enable_seqscan");
    }
  });

  it("returns only selected-tenant versions and items", async () => {
    const result = await client.query<{ version_id: string; item_tenant: string }>(
      `SELECT v.id AS version_id, i.tenant_id AS item_tenant
       FROM price_table_versions v
       JOIN price_table_items i
         ON i.tenant_id = v.tenant_id AND i.price_table_version_id = v.id
       WHERE v.tenant_id = $1`,
      [tenantA],
    );
    expect(result.rows).toEqual([{ version_id: versionA, item_tenant: tenantA }]);
  });
});
