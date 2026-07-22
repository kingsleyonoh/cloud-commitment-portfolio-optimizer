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
let first: Client;
let second: Client;
let tenantId: string;

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_price_tables_concurrency");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  first = new Client({ connectionString: database.url });
  second = new Client({ connectionString: database.url });
  await Promise.all([first.connect(), second.connect()]);
  tenantId = await insertPriceTenant(first, "price concurrency tenant");
});

afterAll(async () => {
  await Promise.all([first?.end(), second?.end()]);
  await dropIsolatedDatabase(database);
});

function digest(label: string): string {
  return createHash("sha256").update(`concurrency:${label}`).digest("hex");
}

async function draftWithItem(client: Client, label: string): Promise<string> {
  const created = await insertPriceVersion(client, tenantId, {
    versionLabel: label,
    checksum: digest(label),
    effectiveTo: "2026-12-31",
  });
  await insertPriceItem(client, tenantId, created.rows[0]!.id, { sku: `sku-${label}` });
  return created.rows[0]!.id;
}

describe("serialized price snapshot writes", () => {
  it("allows exactly one of two overlapping versions to activate concurrently", async () => {
    const firstId = await draftWithItem(first, "active-race-a");
    const secondId = await draftWithItem(second, "active-race-b");
    const outcomes = await Promise.allSettled([
      first.query("UPDATE price_table_versions SET status = 'active' WHERE id = $1", [firstId]),
      second.query("UPDATE price_table_versions SET status = 'active' WHERE id = $1", [secondId]),
    ]);
    expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find(({ status }) => status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: { code: "23P01", message: "active price table effective periods overlap" },
    });
    const active = await first.query<{ count: string }>(
      "SELECT count(*) FROM price_table_versions WHERE tenant_id = $1 AND status = 'active'",
      [tenantId],
    );
    expect(active.rows[0]?.count).toBe("1");
  });

  it("allows exactly one concurrent duplicate dimension insert", async () => {
    const versionId = (
      await insertPriceVersion(first, tenantId, {
        versionLabel: "dimension-race",
        checksum: digest("dimension-race"),
        effectiveFrom: "2027-01-01",
      })
    ).rows[0]!.id;
    const outcomes = await Promise.allSettled([
      insertPriceItem(first, tenantId, versionId),
      insertPriceItem(second, tenantId, versionId),
    ]);
    expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find(({ status }) => status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: { constraint: "price_table_items_tenant_dimensions_key" },
    });
  });
});
