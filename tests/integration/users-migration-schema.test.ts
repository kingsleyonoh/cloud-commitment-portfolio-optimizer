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
  ["email", "text", "NO", null],
  ["name", "text", "NO", null],
  ["role", "text", "NO", null],
  ["is_active", "boolean", "NO", "true"],
  ["created_at", "timestamp with time zone", "NO", "now()"],
  ["updated_at", "timestamp with time zone", "NO", "now()"],
] as const;

let database: IsolatedDatabase | undefined;
let client: Client;

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_users_schema");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  client = new Client({ connectionString: database.url });
  await client.connect();
});

afterAll(async () => {
  if (client) await client.end();
  await dropIsolatedDatabase(database);
});

describe("credential-free users schema", () => {
  it("owns the exact ordered eight-column PostgreSQL contract", async () => {
    const result = await client.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users'
      ORDER BY ordinal_position
    `);

    expect(
      result.rows.map(({ column_name, data_type, is_nullable, column_default }) => [
        column_name,
        data_type,
        is_nullable,
        column_default,
      ]),
    ).toEqual(expectedColumns);
  });

  it("has the exact named constraints and tenant-leading indexes", async () => {
    const constraints = await client.query<{
      name: string;
      type: string;
      delete_action: string;
      definition: string;
    }>(`
      SELECT conname AS name, contype AS type, confdeltype AS delete_action,
             pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'users'::regclass
      ORDER BY conname
    `);
    const indexes = await client.query<{ indexname: string; indexdef: string }>(`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'users'
      ORDER BY indexname
    `);

    expect(constraints.rows.map(({ name, type }) => [name, type])).toEqual([
      ["users_email_canonical_check", "c"],
      ["users_name_trimmed_check", "c"],
      ["users_pkey", "p"],
      ["users_role_check", "c"],
      ["users_tenant_email_key", "u"],
      ["users_tenant_id_fkey", "f"],
      ["users_timestamps_ordered_check", "c"],
    ]);
    expect(constraints.rows.find(({ name }) => name === "users_tenant_id_fkey")).toMatchObject({
      delete_action: "r",
      definition: "FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT",
    });
    expect(indexes.rows).toEqual([
      {
        indexname: "users_pkey",
        indexdef: "CREATE UNIQUE INDEX users_pkey ON public.users USING btree (id)",
      },
      {
        indexname: "users_tenant_email_key",
        indexdef:
          "CREATE UNIQUE INDEX users_tenant_email_key ON public.users USING btree (tenant_id, email)",
      },
      {
        indexname: "users_tenant_id_id_key",
        indexdef:
          "CREATE UNIQUE INDEX users_tenant_id_id_key ON public.users USING btree (tenant_id, id)",
      },
      {
        indexname: "users_tenant_role_active_idx",
        indexdef:
          "CREATE INDEX users_tenant_role_active_idx ON public.users USING btree (tenant_id, role, is_active)",
      },
    ]);
  });

  it("uses its own update function and trigger", async () => {
    const functions = await client.query<{ name: string }>(`
      SELECT proname AS name
      FROM pg_proc JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
      WHERE nspname = 'public' ORDER BY proname
    `);
    const triggers = await client.query<{ name: string; definition: string }>(`
      SELECT tgname AS name, pg_get_triggerdef(oid) AS definition
      FROM pg_trigger WHERE tgrelid = 'users'::regclass AND NOT tgisinternal
    `);

    expect(functions.rows.map(({ name }) => name)).toEqual([
      "enforce_forecast_model_lifecycle",
      "enforce_forecast_run_lifecycle",
      "enforce_price_table_item_snapshot",
      "enforce_price_table_version_lifecycle",
      "forecast_scope_is_canonical",
      "mark_auth_refresh_token_used",
      "reject_audit_log_mutation",
      "reject_usage_line_item_mutation",
      "set_auth_refresh_families_updated_at",
      "set_cloud_accounts_updated_at",
      "set_import_batches_updated_at",
      "set_registration_requests_updated_at",
      "set_tenants_updated_at",
      "set_user_auth_credentials_updated_at",
      "set_users_updated_at",
    ]);
    expect(triggers.rows).toHaveLength(1);
    expect(triggers.rows[0]).toMatchObject({ name: "users_set_updated_at" });
    expect(triggers.rows[0]?.definition).toMatch(
      /BEFORE UPDATE ON public\.users FOR EACH ROW EXECUTE FUNCTION set_users_updated_at\(\)/iu,
    );
  });

  it("creates no user rows, user credential columns, or extensions", async () => {
    const rows = await client.query<{ count: string }>("SELECT count(*) FROM users");
    const columns = await client.query<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users'
    `);
    const tables = await client.query<{ tablename: string }>(`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
    `);
    const extensions = await client.query<{ extname: string }>(
      "SELECT extname FROM pg_extension ORDER BY extname",
    );

    expect(rows.rows[0]?.count).toBe("0");
    expect(columns.rows.map(({ column_name }) => column_name)).not.toEqual(
      expect.arrayContaining(["password", "password_hash", "api_key", "key_hash", "token"]),
    );
    expect(tables.rows.map(({ tablename }) => tablename)).toEqual([
      "_ccpo_schema_migrations",
      "api_keys",
      "audit_log",
      "auth_refresh_families",
      "auth_refresh_tokens",
      "cloud_accounts",
      "forecast_models",
      "forecast_runs",
      "import_batches",
      "price_table_items",
      "price_table_versions",
      "registration_requests",
      "tenants",
      "usage_line_items",
      "user_auth_credentials",
      "users",
    ]);
    expect(extensions.rows.map(({ extname }) => extname)).toEqual(["plpgsql"]);
  });
});
