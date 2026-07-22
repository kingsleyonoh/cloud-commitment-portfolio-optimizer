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
  ["user_id", "uuid", "NO", null],
  ["absolute_expires_at", "timestamp with time zone", "NO", null],
  ["revoked_at", "timestamp with time zone", "YES", null],
  ["revocation_reason", "text", "YES", null],
  ["created_at", "timestamp with time zone", "NO", "now()"],
  ["updated_at", "timestamp with time zone", "NO", "now()"],
] as const;
let database: IsolatedDatabase | undefined;
let client: Client;

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_refresh_family_schema");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  client = new Client({ connectionString: database.url });
  await client.connect();
});

afterAll(async () => {
  if (client) await client.end();
  await dropIsolatedDatabase(database);
});

describe("stable refresh family schema", () => {
  it("owns the exact ordered eight-column contract and starts empty", async () => {
    const result = await client.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'auth_refresh_families'
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
    const rows = await client.query<{ count: string }>(
      "SELECT count(*) FROM auth_refresh_families",
    );
    expect(rows.rows[0]?.count).toBe("0");
  });

  it("has exactly the named ownership, authority, and chronology constraints", async () => {
    const result = await client.query<{
      name: string;
      type: string;
      delete_action: string;
      definition: string;
    }>(`
      SELECT conname AS name, contype AS type, confdeltype AS delete_action,
             pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'auth_refresh_families'::regclass ORDER BY conname
    `);
    expect(result.rows.map(({ name, type }) => [name, type])).toEqual([
      ["auth_refresh_families_absolute_expiry_check", "c"],
      ["auth_refresh_families_pkey", "p"],
      ["auth_refresh_families_revocation_chronology_check", "c"],
      ["auth_refresh_families_revocation_coupling_check", "c"],
      ["auth_refresh_families_revocation_reason_check", "c"],
      ["auth_refresh_families_tenant_id_fkey", "f"],
      ["auth_refresh_families_tenant_id_id_key", "u"],
      ["auth_refresh_families_tenant_user_fkey", "f"],
      ["auth_refresh_families_timestamps_ordered_check", "c"],
    ]);
    const constraints = new Map(result.rows.map((row) => [row.name, row]));
    expect(constraints.get("auth_refresh_families_tenant_id_fkey")).toMatchObject({
      delete_action: "r",
      definition: "FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT",
    });
    expect(constraints.get("auth_refresh_families_tenant_user_fkey")).toMatchObject({
      delete_action: "r",
      definition:
        "FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE RESTRICT",
    });
    expect(constraints.get("auth_refresh_families_revocation_reason_check")?.definition).toMatch(
      /logout.*reuse_detected.*password_reset.*user_inactive.*tenant_inactive.*role_changed.*operator_revoked/iu,
    );
  });

  it("has only the exact primary, tenant-leading, and active-expiry indexes", async () => {
    const result = await client.query<{ indexname: string; indexdef: string }>(`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'auth_refresh_families'
      ORDER BY indexname
    `);
    expect(result.rows).toEqual([
      {
        indexname: "auth_refresh_families_active_absolute_expiry_idx",
        indexdef:
          "CREATE INDEX auth_refresh_families_active_absolute_expiry_idx ON public.auth_refresh_families USING btree (absolute_expires_at) WHERE (revoked_at IS NULL)",
      },
      {
        indexname: "auth_refresh_families_pkey",
        indexdef:
          "CREATE UNIQUE INDEX auth_refresh_families_pkey ON public.auth_refresh_families USING btree (id)",
      },
      {
        indexname: "auth_refresh_families_tenant_id_id_key",
        indexdef:
          "CREATE UNIQUE INDEX auth_refresh_families_tenant_id_id_key ON public.auth_refresh_families USING btree (tenant_id, id)",
      },
      {
        indexname: "auth_refresh_families_tenant_user_revoked_created_idx",
        indexdef:
          "CREATE INDEX auth_refresh_families_tenant_user_revoked_created_idx ON public.auth_refresh_families USING btree (tenant_id, user_id, revoked_at, created_at DESC, id DESC)",
      },
    ]);
  });

  it("owns one scoped BEFORE UPDATE timestamp and authority trigger", async () => {
    const result = await client.query<{ name: string; definition: string; function_name: string }>(`
      SELECT tgname AS name, pg_get_triggerdef(pg_trigger.oid) AS definition,
             pg_proc.proname AS function_name
      FROM pg_trigger JOIN pg_proc ON pg_proc.oid = pg_trigger.tgfoid
      WHERE tgrelid = 'auth_refresh_families'::regclass AND NOT tgisinternal
      ORDER BY tgname
    `);
    expect(result.rows).toEqual([
      {
        name: "auth_refresh_families_set_updated_at",
        definition:
          "CREATE TRIGGER auth_refresh_families_set_updated_at BEFORE UPDATE ON public.auth_refresh_families FOR EACH ROW EXECUTE FUNCTION set_auth_refresh_families_updated_at()",
        function_name: "set_auth_refresh_families_updated_at",
      },
    ]);
  });
});
