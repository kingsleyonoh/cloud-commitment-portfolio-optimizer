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
const expectedColumns = [
  ["id", "uuid", "NO", "gen_random_uuid()", null, null],
  ["tenant_id", "uuid", "NO", null, null, null],
  ["import_batch_id", "uuid", "NO", null, null, null],
  ["cloud_account_id", "uuid", "NO", null, null, null],
  ["provider", "text", "NO", null, null, null],
  ["service_code", "text", "NO", null, null, null],
  ["sku", "text", "NO", null, null, null],
  ["region", "text", "NO", null, null, null],
  ["usage_start", "timestamp with time zone", "NO", null, null, null],
  ["usage_end", "timestamp with time zone", "NO", null, null, null],
  ["usage_quantity", "numeric", "NO", null, 20, 8],
  ["usage_unit", "text", "NO", null, null, null],
  ["on_demand_cost_cents", "bigint", "NO", null, 64, 0],
  ["realized_cost_cents", "bigint", "NO", null, 64, 0],
  ["commitment_applied_cents", "bigint", "NO", "0", 64, 0],
  ["tags", "jsonb", "NO", "'{}'::jsonb", null, null],
  ["created_at", "timestamp with time zone", "NO", "now()", null, null],
] as const;
let database: IsolatedDatabase | undefined;
let client: Client;

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_usage_line_items_schema");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  client = new Client({ connectionString: database.url });
  await client.connect();
});

afterAll(async () => {
  if (client) await client.end();
  await dropIsolatedDatabase(database);
});

describe("canonical usage line items catalog", () => {
  it("owns exactly the ordered seventeen-column PRD 4.5 contract with no extras", async () => {
    const result = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default,
             numeric_precision, numeric_scale
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'usage_line_items'
      ORDER BY ordinal_position
    `);
    expect(result.rows.map((row) => Object.values(row))).toEqual(expectedColumns);
    expect(expectedColumns.map(([name]) => name)).not.toEqual(
      expect.arrayContaining([
        "source_row_id",
        "resource_id",
        "operation",
        "usage_type",
        "currency",
        "commitment_eligible",
        "eligibility_reason",
        "metadata",
        "updated_at",
      ]),
    );
    expect((await client.query("SELECT count(*) FROM usage_line_items")).rows[0]?.count).toBe("0");
  });

  it("has exact checks and same-tenant ownership constraints", async () => {
    const result = await client.query<{ name: string; type: string; definition: string }>(`
      SELECT conname AS name, contype AS type, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint WHERE conrelid = 'usage_line_items'::regclass ORDER BY conname
    `);
    expect(result.rows.map(({ name, type }) => [name, type])).toEqual([
      ["usage_line_items_commitment_allocation_check", "c"],
      ["usage_line_items_costs_nonnegative_check", "c"],
      ["usage_line_items_pkey", "p"],
      ["usage_line_items_provider_check", "c"],
      ["usage_line_items_region_canonical_check", "c"],
      ["usage_line_items_service_code_canonical_check", "c"],
      ["usage_line_items_sku_canonical_check", "c"],
      ["usage_line_items_tags_object_check", "c"],
      ["usage_line_items_tenant_cloud_account_fkey", "f"],
      ["usage_line_items_tenant_id_fkey", "f"],
      ["usage_line_items_tenant_import_batch_fkey", "f"],
      ["usage_line_items_usage_period_check", "c"],
      ["usage_line_items_usage_quantity_nonnegative_check", "c"],
      ["usage_line_items_usage_unit_canonical_check", "c"],
    ]);
    expect(result.rows.find(({ name }) => name.endsWith("import_batch_fkey"))?.definition).toBe(
      "FOREIGN KEY (tenant_id, import_batch_id) REFERENCES import_batches(tenant_id, id) ON DELETE RESTRICT",
    );
    expect(result.rows.find(({ name }) => name.endsWith("cloud_account_fkey"))?.definition).toBe(
      "FOREIGN KEY (tenant_id, cloud_account_id) REFERENCES cloud_accounts(tenant_id, id) ON DELETE RESTRICT",
    );
  });

  it("has only the primary and three exact tenant-leading usage indexes", async () => {
    const result = await client.query(`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'usage_line_items' ORDER BY indexname
    `);
    expect(result.rows).toEqual([
      {
        indexname: "usage_line_items_pkey",
        indexdef:
          "CREATE UNIQUE INDEX usage_line_items_pkey ON public.usage_line_items USING btree (id)",
      },
      {
        indexname: "usage_line_items_tenant_account_usage_start_idx",
        indexdef:
          "CREATE INDEX usage_line_items_tenant_account_usage_start_idx ON public.usage_line_items USING btree (tenant_id, cloud_account_id, usage_start)",
      },
      {
        indexname: "usage_line_items_tenant_import_batch_idx",
        indexdef:
          "CREATE INDEX usage_line_items_tenant_import_batch_idx ON public.usage_line_items USING btree (tenant_id, import_batch_id)",
      },
      {
        indexname: "usage_line_items_tenant_usage_dimensions_idx",
        indexdef:
          "CREATE INDEX usage_line_items_tenant_usage_dimensions_idx ON public.usage_line_items USING btree (tenant_id, provider, service_code, region, usage_start)",
      },
    ]);
  });

  it("adds only required composite ownership support and an immutability trigger", async () => {
    const support = await client.query(`
      SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'
        AND indexname IN ('cloud_accounts_tenant_id_id_key', 'import_batches_tenant_id_id_key')
      ORDER BY indexname
    `);
    expect(support.rows).toEqual([
      {
        indexname: "cloud_accounts_tenant_id_id_key",
        indexdef:
          "CREATE UNIQUE INDEX cloud_accounts_tenant_id_id_key ON public.cloud_accounts USING btree (tenant_id, id)",
      },
      {
        indexname: "import_batches_tenant_id_id_key",
        indexdef:
          "CREATE UNIQUE INDEX import_batches_tenant_id_id_key ON public.import_batches USING btree (tenant_id, id)",
      },
    ]);
    const triggers = await client.query(`
      SELECT tgname AS name, pg_proc.proname AS function_name FROM pg_trigger
      JOIN pg_proc ON pg_proc.oid = pg_trigger.tgfoid
      WHERE tgrelid = 'usage_line_items'::regclass AND NOT tgisinternal
    `);
    expect(triggers.rows).toEqual([
      {
        name: "usage_line_items_reject_mutation",
        function_name: "reject_usage_line_item_mutation",
      },
    ]);
  });
});
