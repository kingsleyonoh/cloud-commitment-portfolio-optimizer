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
  ["id", "uuid", "NO", "gen_random_uuid()"],
  ["tenant_id", "uuid", "NO", null],
  ["provider", "text", "NO", null],
  ["external_ref", "text", "NO", null],
  ["display_name", "text", "NO", null],
  ["currency", "text", "NO", null],
  ["tags", "jsonb", "NO", "'{}'::jsonb"],
  ["is_active", "boolean", "NO", "true"],
  ["created_at", "timestamp with time zone", "NO", "now()"],
  ["updated_at", "timestamp with time zone", "NO", "now()"],
] as const;
let database: IsolatedDatabase | undefined;
let client: Client;

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_cloud_accounts_schema");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  client = new Client({ connectionString: database.url });
  await client.connect();
});

afterAll(async () => {
  if (client) await client.end();
  await dropIsolatedDatabase(database);
});

describe("canonical cloud accounts schema", () => {
  it("owns exactly the ordered credential-free ten-column contract and starts empty", async () => {
    const columns = await client.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'cloud_accounts'
      ORDER BY ordinal_position
    `);
    expect(
      columns.rows.map(({ column_name, data_type, is_nullable, column_default }) => [
        column_name,
        data_type,
        is_nullable,
        column_default,
      ]),
    ).toEqual(expectedColumns);
    expect(expectedColumns.map(([name]) => name)).not.toEqual(
      expect.arrayContaining([
        "status",
        "credentials",
        "credential",
        "secret",
        "access_key",
        "role_arn",
        "subscription_secret",
        "service_account_key",
      ]),
    );
    const rows = await client.query<{ count: string }>("SELECT count(*) FROM cloud_accounts");
    expect(rows.rows[0]?.count).toBe("0");
  });

  it("has exactly the named identity, validation, ownership, and chronology constraints", async () => {
    const result = await client.query<{
      name: string;
      type: string;
      delete_action: string;
      definition: string;
    }>(`
      SELECT conname AS name, contype AS type, confdeltype AS delete_action,
             pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'cloud_accounts'::regclass ORDER BY conname
    `);
    expect(result.rows.map(({ name, type }) => [name, type])).toEqual([
      ["cloud_accounts_currency_shape_check", "c"],
      ["cloud_accounts_display_name_trimmed_check", "c"],
      ["cloud_accounts_external_ref_canonical_check", "c"],
      ["cloud_accounts_pkey", "p"],
      ["cloud_accounts_provider_check", "c"],
      ["cloud_accounts_tags_object_check", "c"],
      ["cloud_accounts_tenant_id_fkey", "f"],
      ["cloud_accounts_tenant_provider_external_ref_key", "u"],
      ["cloud_accounts_timestamps_ordered_check", "c"],
    ]);
    expect(result.rows.find(({ name }) => name === "cloud_accounts_tenant_id_fkey")).toMatchObject({
      delete_action: "r",
      definition: "FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT",
    });
  });

  it("has exactly the primary, tenant/provider identity, and active lookup indexes", async () => {
    const result = await client.query<{ indexname: string; indexdef: string }>(`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'cloud_accounts'
      ORDER BY indexname
    `);
    expect(result.rows).toEqual([
      {
        indexname: "cloud_accounts_pkey",
        indexdef:
          "CREATE UNIQUE INDEX cloud_accounts_pkey ON public.cloud_accounts USING btree (id)",
      },
      {
        indexname: "cloud_accounts_tenant_id_id_key",
        indexdef:
          "CREATE UNIQUE INDEX cloud_accounts_tenant_id_id_key ON public.cloud_accounts USING btree (tenant_id, id)",
      },
      {
        indexname: "cloud_accounts_tenant_provider_active_idx",
        indexdef:
          "CREATE INDEX cloud_accounts_tenant_provider_active_idx ON public.cloud_accounts USING btree (tenant_id, provider, is_active)",
      },
      {
        indexname: "cloud_accounts_tenant_provider_external_ref_key",
        indexdef:
          "CREATE UNIQUE INDEX cloud_accounts_tenant_provider_external_ref_key ON public.cloud_accounts USING btree (tenant_id, provider, external_ref)",
      },
    ]);
  });

  it("owns one table-scoped database-managed BEFORE UPDATE trigger", async () => {
    const result = await client.query<{ name: string; definition: string; function_name: string }>(`
      SELECT tgname AS name, pg_get_triggerdef(pg_trigger.oid) AS definition,
             pg_proc.proname AS function_name
      FROM pg_trigger JOIN pg_proc ON pg_proc.oid = pg_trigger.tgfoid
      WHERE tgrelid = 'cloud_accounts'::regclass AND NOT tgisinternal
      ORDER BY tgname
    `);
    expect(result.rows).toEqual([
      {
        name: "cloud_accounts_set_updated_at",
        definition:
          "CREATE TRIGGER cloud_accounts_set_updated_at BEFORE UPDATE ON public.cloud_accounts FOR EACH ROW EXECUTE FUNCTION set_cloud_accounts_updated_at()",
        function_name: "set_cloud_accounts_updated_at",
      },
    ]);
  });
});
