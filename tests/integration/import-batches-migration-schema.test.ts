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
  ["cloud_account_id", "uuid", "YES", null],
  ["source", "text", "NO", null],
  ["format", "text", "NO", null],
  ["status", "text", "NO", "'queued'::text"],
  ["object_uri", "text", "NO", null],
  ["schema_version", "text", "NO", null],
  ["line_count", "bigint", "NO", "0"],
  ["error_details", "jsonb", "NO", "'{}'::jsonb"],
  ["parser_warnings", "jsonb", "NO", "'[]'::jsonb"],
  ["created_by_user_id", "uuid", "YES", null],
  ["created_at", "timestamp with time zone", "NO", "now()"],
  ["updated_at", "timestamp with time zone", "NO", "now()"],
] as const;
let database: IsolatedDatabase | undefined;
let client: Client;

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_import_batches_schema");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  client = new Client({ connectionString: database.url });
  await client.connect();
});

afterAll(async () => {
  if (client) await client.end();
  await dropIsolatedDatabase(database);
});

describe("canonical import batches schema", () => {
  it("owns exactly the ordered fourteen-column resumable parser contract", async () => {
    const columns = await client.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'import_batches'
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
    const rows = await client.query<{ count: string }>("SELECT count(*) FROM import_batches");
    expect(rows.rows[0]?.count).toBe("0");
  });

  it("has exactly the named ownership, enum, metadata, and chronology constraints", async () => {
    const result = await client.query<{ name: string; type: string; definition: string }>(`
      SELECT conname AS name, contype AS type, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'import_batches'::regclass ORDER BY conname
    `);
    expect(result.rows.map(({ name, type }) => [name, type])).toEqual([
      ["import_batches_error_details_object_check", "c"],
      ["import_batches_format_check", "c"],
      ["import_batches_line_count_nonnegative_check", "c"],
      ["import_batches_object_uri_trimmed_check", "c"],
      ["import_batches_parser_warnings_array_check", "c"],
      ["import_batches_pkey", "p"],
      ["import_batches_schema_version_trimmed_check", "c"],
      ["import_batches_source_check", "c"],
      ["import_batches_status_check", "c"],
      ["import_batches_tenant_cloud_account_fkey", "f"],
      ["import_batches_tenant_created_by_user_fkey", "f"],
      ["import_batches_tenant_id_fkey", "f"],
      ["import_batches_timestamps_ordered_check", "c"],
    ]);
    expect(
      result.rows.find(({ name }) => name === "import_batches_tenant_id_fkey")?.definition,
    ).toBe("FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT");
    expect(
      result.rows.find(({ name }) => name === "import_batches_tenant_cloud_account_fkey")
        ?.definition,
    ).toBe(
      "FOREIGN KEY (tenant_id, cloud_account_id) REFERENCES cloud_accounts(tenant_id, id) ON DELETE RESTRICT",
    );
    expect(
      result.rows.find(({ name }) => name === "import_batches_tenant_created_by_user_fkey")
        ?.definition,
    ).toBe(
      "FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES users(tenant_id, id) ON DELETE RESTRICT",
    );
    const support = await client.query<{ indexname: string; indexdef: string }>(`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN ('cloud_accounts_tenant_id_id_key', 'users_tenant_id_id_key')
      ORDER BY indexname
    `);
    expect(support.rows).toEqual([
      {
        indexname: "cloud_accounts_tenant_id_id_key",
        indexdef:
          "CREATE UNIQUE INDEX cloud_accounts_tenant_id_id_key ON public.cloud_accounts USING btree (tenant_id, id)",
      },
      {
        indexname: "users_tenant_id_id_key",
        indexdef:
          "CREATE UNIQUE INDEX users_tenant_id_id_key ON public.users USING btree (tenant_id, id)",
      },
    ]);
  });

  it("has primary, exact tenant-leading, and usage ownership support indexes", async () => {
    const result = await client.query<{ indexname: string; indexdef: string }>(`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'import_batches'
      ORDER BY indexname
    `);
    expect(result.rows).toEqual([
      {
        indexname: "import_batches_pkey",
        indexdef:
          "CREATE UNIQUE INDEX import_batches_pkey ON public.import_batches USING btree (id)",
      },
      {
        indexname: "import_batches_tenant_cloud_account_created_idx",
        indexdef:
          "CREATE INDEX import_batches_tenant_cloud_account_created_idx ON public.import_batches USING btree (tenant_id, cloud_account_id, created_at)",
      },
      {
        indexname: "import_batches_tenant_id_id_key",
        indexdef:
          "CREATE UNIQUE INDEX import_batches_tenant_id_id_key ON public.import_batches USING btree (tenant_id, id)",
      },
      {
        indexname: "import_batches_tenant_status_created_idx",
        indexdef:
          "CREATE INDEX import_batches_tenant_status_created_idx ON public.import_batches USING btree (tenant_id, status, created_at)",
      },
    ]);
  });

  it("owns one database-managed BEFORE UPDATE timestamp trigger", async () => {
    const result = await client.query<{ name: string; function_name: string }>(`
      SELECT tgname AS name, pg_proc.proname AS function_name
      FROM pg_trigger JOIN pg_proc ON pg_proc.oid = pg_trigger.tgfoid
      WHERE tgrelid = 'import_batches'::regclass AND NOT tgisinternal
    `);
    expect(result.rows).toEqual([
      { name: "import_batches_set_updated_at", function_name: "set_import_batches_updated_at" },
    ]);
  });
});
