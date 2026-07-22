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
const versionColumns = [
  ["id", "uuid", "NO", "gen_random_uuid()", null, null],
  ["tenant_id", "uuid", "NO", null, null, null],
  ["provider", "text", "NO", null, null, null],
  ["instrument", "text", "NO", null, null, null],
  ["version_label", "text", "NO", null, null, null],
  ["effective_from", "date", "NO", null, null, null],
  ["effective_to", "date", "YES", null, null, null],
  ["source_uri", "text", "NO", null, null, null],
  ["status", "text", "NO", null, null, null],
  ["checksum", "text", "NO", null, null, null],
  ["created_at", "timestamp with time zone", "NO", "now()", null, null],
  ["updated_at", "timestamp with time zone", "NO", "now()", null, null],
] as const;
const itemColumns = [
  ["id", "uuid", "NO", "gen_random_uuid()", null, null],
  ["tenant_id", "uuid", "NO", null, null, null],
  ["price_table_version_id", "uuid", "NO", null, null, null],
  ["provider", "text", "NO", null, null, null],
  ["instrument", "text", "NO", null, null, null],
  ["sku", "text", "NO", null, null, null],
  ["region", "text", "NO", null, null, null],
  ["term_months", "integer", "NO", null, 32, 0],
  ["payment_option", "text", "NO", null, null, null],
  ["hourly_rate_cents", "bigint", "NO", null, 64, 0],
  ["upfront_cents", "bigint", "NO", "0", 64, 0],
  ["coverage_rules", "jsonb", "NO", "'{}'::jsonb", null, null],
  ["created_at", "timestamp with time zone", "NO", "now()", null, null],
] as const;
let database: IsolatedDatabase | undefined;
let client: Client;

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_price_tables_schema");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  client = new Client({ connectionString: database.url });
  await client.connect();
});

afterAll(async () => {
  if (client) await client.end();
  await dropIsolatedDatabase(database);
});

async function columns(table: string) {
  const result = await client.query(
    `SELECT column_name, data_type, is_nullable, column_default,
            numeric_precision, numeric_scale
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
    [table],
  );
  return result.rows.map((row) => Object.values(row));
}

async function constraints(table: string) {
  return client.query<{ name: string; type: string; definition: string }>(`
    SELECT conname AS name, contype AS type, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint WHERE conrelid = '${table}'::regclass ORDER BY conname
  `);
}

describe("exact PRD 4.6 and 4.7 price catalogs", () => {
  it("owns only the ordered canonical version and item columns", async () => {
    expect(await columns("price_table_versions")).toEqual(versionColumns);
    expect(await columns("price_table_items")).toEqual(itemColumns);
    const extras = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('price_table_versions', 'price_table_items')
        AND column_name IN (
          'parser', 'parser_version', 'metadata', 'raw_file', 'credentials', 'currency',
          'service_code', 'purchase_option', 'offering_class', 'tenancy', 'platform',
          'instance_type', 'unit', 'rate', 'rate_start', 'rate_end', 'updated_at'
        )
        AND NOT (table_name = 'price_table_versions' AND column_name = 'updated_at')
    `);
    expect(extras.rows).toEqual([]);
  });

  it("has exact version ownership, identity, period, digest, and lifecycle checks", async () => {
    const result = await constraints("price_table_versions");
    expect(result.rows.map(({ name, type }) => [name, type])).toEqual([
      ["price_table_versions_checksum_shape_check", "c"],
      ["price_table_versions_effective_period_check", "c"],
      ["price_table_versions_instrument_check", "c"],
      ["price_table_versions_pkey", "p"],
      ["price_table_versions_provider_check", "c"],
      ["price_table_versions_provider_instrument_check", "c"],
      ["price_table_versions_source_uri_canonical_check", "c"],
      ["price_table_versions_status_check", "c"],
      ["price_table_versions_tenant_checksum_key", "u"],
      ["price_table_versions_tenant_id_fkey", "f"],
      ["price_table_versions_tenant_version_label_key", "u"],
      ["price_table_versions_timestamps_ordered_check", "c"],
      ["price_table_versions_version_label_canonical_check", "c"],
    ]);
    expect(result.rows.find(({ name }) => name.endsWith("tenant_id_fkey"))?.definition).toBe(
      "FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT",
    );
  });

  it("has exact item ownership, dimensions, economics, JSON, and duplicate checks", async () => {
    const result = await constraints("price_table_items");
    expect(result.rows.map(({ name, type }) => [name, type])).toEqual([
      ["price_table_items_coverage_rules_object_check", "c"],
      ["price_table_items_economics_nonnegative_check", "c"],
      ["price_table_items_instrument_check", "c"],
      ["price_table_items_payment_option_check", "c"],
      ["price_table_items_pkey", "p"],
      ["price_table_items_provider_check", "c"],
      ["price_table_items_provider_instrument_check", "c"],
      ["price_table_items_region_canonical_check", "c"],
      ["price_table_items_sku_canonical_check", "c"],
      ["price_table_items_tenant_dimensions_key", "u"],
      ["price_table_items_tenant_id_fkey", "f"],
      ["price_table_items_tenant_version_fkey", "f"],
      ["price_table_items_term_months_positive_check", "c"],
    ]);
    expect(result.rows.find(({ name }) => name.endsWith("tenant_version_fkey"))?.definition).toBe(
      "FOREIGN KEY (tenant_id, price_table_version_id, provider, instrument) REFERENCES price_table_versions(tenant_id, id, provider, instrument) ON DELETE RESTRICT",
    );
  });

  it("has only canonical query indexes plus ownership and uniqueness support", async () => {
    const result = await client.query<{ tablename: string; indexname: string }>(`
      SELECT tablename, indexname FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename IN ('price_table_versions', 'price_table_items')
      ORDER BY tablename, indexname
    `);
    expect(result.rows).toEqual([
      { tablename: "price_table_items", indexname: "price_table_items_pkey" },
      { tablename: "price_table_items", indexname: "price_table_items_tenant_dimensions_idx" },
      { tablename: "price_table_items", indexname: "price_table_items_tenant_dimensions_key" },
      {
        tablename: "price_table_items",
        indexname: "price_table_items_tenant_version_sku_region_idx",
      },
      { tablename: "price_table_versions", indexname: "price_table_versions_pkey" },
      { tablename: "price_table_versions", indexname: "price_table_versions_tenant_checksum_key" },
      { tablename: "price_table_versions", indexname: "price_table_versions_tenant_identity_key" },
      { tablename: "price_table_versions", indexname: "price_table_versions_tenant_lookup_idx" },
      {
        tablename: "price_table_versions",
        indexname: "price_table_versions_tenant_version_label_key",
      },
    ]);
  });

  it("installs immutable snapshot triggers and no seed rows", async () => {
    const triggers = await client.query(`
      SELECT c.relname AS table_name, t.tgname AS name, p.proname AS function_name
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE c.relname IN ('price_table_versions', 'price_table_items') AND NOT t.tgisinternal
      ORDER BY c.relname, t.tgname
    `);
    expect(triggers.rows).toEqual([
      {
        table_name: "price_table_items",
        name: "price_table_items_enforce_snapshot",
        function_name: "enforce_price_table_item_snapshot",
      },
      {
        table_name: "price_table_versions",
        name: "price_table_versions_enforce_lifecycle",
        function_name: "enforce_price_table_version_lifecycle",
      },
    ]);
    const counts = await client.query(`
      SELECT (SELECT count(*)::text FROM price_table_versions) AS versions,
             (SELECT count(*)::text FROM price_table_items) AS items
    `);
    expect(counts.rows[0]).toEqual({ versions: "0", items: "0" });
  });
});
