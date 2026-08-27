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
  ["family_id", "uuid", "NO", null],
  ["parent_token_id", "uuid", "YES", null],
  ["token_digest", "bytea", "NO", null],
  ["csrf_digest", "bytea", "NO", null],
  ["idle_expires_at", "timestamp with time zone", "NO", null],
  ["used_at", "timestamp with time zone", "YES", null],
  ["created_at", "timestamp with time zone", "NO", "now()"],
  ["updated_at", "timestamp with time zone", "NO", "now()"],
] as const;
let database: IsolatedDatabase | undefined;
let client: Client;

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_refresh_token_schema");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  client = new Client({ connectionString: database.url });
  await client.connect();
});

afterAll(async () => {
  if (client) await client.end();
  await dropIsolatedDatabase(database);
});

describe("rotating refresh token schema", () => {
  it("owns the exact ordered ten-column contract and starts empty", async () => {
    const result = await client.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'auth_refresh_tokens'
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
    const rows = await client.query<{ count: string }>("SELECT count(*) FROM auth_refresh_tokens");
    expect(rows.rows[0]?.count).toBe("0");
    expect(expectedColumns.map(([name]) => name)).not.toEqual(
      expect.arrayContaining([
        "token",
        "csrf_token",
        "plaintext",
        "secret",
        "cookie",
        "jwt",
        "ip_address",
        "user_agent",
      ]),
    );
  });

  it("has exactly the named digest, lineage, ownership, and chronology constraints", async () => {
    const result = await client.query<{
      name: string;
      type: string;
      delete_action: string;
      definition: string;
    }>(`
      SELECT conname AS name, contype AS type, confdeltype AS delete_action,
             pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'auth_refresh_tokens'::regclass ORDER BY conname
    `);
    expect(result.rows.map(({ name, type }) => [name, type])).toEqual([
      ["auth_refresh_tokens_csrf_digest_length_check", "c"],
      ["auth_refresh_tokens_idle_expiry_check", "c"],
      ["auth_refresh_tokens_parent_not_self_check", "c"],
      ["auth_refresh_tokens_parent_same_family_fkey", "f"],
      ["auth_refresh_tokens_pkey", "p"],
      ["auth_refresh_tokens_tenant_family_fkey", "f"],
      ["auth_refresh_tokens_tenant_family_id_key", "u"],
      ["auth_refresh_tokens_tenant_id_fkey", "f"],
      ["auth_refresh_tokens_timestamps_ordered_check", "c"],
      ["auth_refresh_tokens_token_digest_key", "u"],
      ["auth_refresh_tokens_token_digest_length_check", "c"],
    ]);
    const constraints = new Map(result.rows.map((row) => [row.name, row]));
    expect(constraints.get("auth_refresh_tokens_tenant_family_fkey")).toMatchObject({
      delete_action: "r",
      definition:
        "FOREIGN KEY (tenant_id, family_id) REFERENCES auth_refresh_families(tenant_id, id) ON DELETE RESTRICT",
    });
    expect(constraints.get("auth_refresh_tokens_parent_same_family_fkey")).toMatchObject({
      delete_action: "r",
      definition:
        "FOREIGN KEY (tenant_id, family_id, parent_token_id) REFERENCES auth_refresh_tokens(tenant_id, family_id, id) ON DELETE RESTRICT",
    });
    expect(constraints.get("auth_refresh_tokens_tenant_id_fkey")).toMatchObject({
      delete_action: "r",
      definition: "FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT",
    });
  });

  it("has the exact global, partial-lineage, tenant, and expiry indexes", async () => {
    const result = await client.query<{ indexname: string; indexdef: string }>(`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'auth_refresh_tokens'
      ORDER BY indexname
    `);
    expect(result.rows).toEqual([
      {
        indexname: "auth_refresh_tokens_active_idle_expiry_idx",
        indexdef:
          "CREATE INDEX auth_refresh_tokens_active_idle_expiry_idx ON public.auth_refresh_tokens USING btree (idle_expires_at) WHERE (used_at IS NULL)",
      },
      {
        indexname: "auth_refresh_tokens_one_child_per_parent_key",
        indexdef:
          "CREATE UNIQUE INDEX auth_refresh_tokens_one_child_per_parent_key ON public.auth_refresh_tokens USING btree (parent_token_id) WHERE (parent_token_id IS NOT NULL)",
      },
      {
        indexname: "auth_refresh_tokens_one_current_family_key",
        indexdef:
          "CREATE UNIQUE INDEX auth_refresh_tokens_one_current_family_key ON public.auth_refresh_tokens USING btree (family_id) WHERE (used_at IS NULL)",
      },
      {
        indexname: "auth_refresh_tokens_one_root_family_key",
        indexdef:
          "CREATE UNIQUE INDEX auth_refresh_tokens_one_root_family_key ON public.auth_refresh_tokens USING btree (family_id) WHERE (parent_token_id IS NULL)",
      },
      {
        indexname: "auth_refresh_tokens_pkey",
        indexdef:
          "CREATE UNIQUE INDEX auth_refresh_tokens_pkey ON public.auth_refresh_tokens USING btree (id)",
      },
      {
        indexname: "auth_refresh_tokens_tenant_family_created_idx",
        indexdef:
          "CREATE INDEX auth_refresh_tokens_tenant_family_created_idx ON public.auth_refresh_tokens USING btree (tenant_id, family_id, created_at, id)",
      },
      {
        indexname: "auth_refresh_tokens_tenant_family_id_key",
        indexdef:
          "CREATE UNIQUE INDEX auth_refresh_tokens_tenant_family_id_key ON public.auth_refresh_tokens USING btree (tenant_id, family_id, id)",
      },
      {
        indexname: "auth_refresh_tokens_token_digest_key",
        indexdef:
          "CREATE UNIQUE INDEX auth_refresh_tokens_token_digest_key ON public.auth_refresh_tokens USING btree (token_digest)",
      },
    ]);
  });

  it("owns one scoped one-time-use BEFORE UPDATE trigger", async () => {
    const result = await client.query<{ name: string; definition: string; function_name: string }>(`
      SELECT tgname AS name, pg_get_triggerdef(pg_trigger.oid) AS definition,
             pg_proc.proname AS function_name
      FROM pg_trigger JOIN pg_proc ON pg_proc.oid = pg_trigger.tgfoid
      WHERE tgrelid = 'auth_refresh_tokens'::regclass AND NOT tgisinternal
      ORDER BY tgname
    `);
    expect(result.rows).toEqual([
      {
        name: "auth_refresh_tokens_mark_used",
        definition:
          "CREATE TRIGGER auth_refresh_tokens_mark_used BEFORE UPDATE ON public.auth_refresh_tokens FOR EACH ROW EXECUTE FUNCTION mark_auth_refresh_token_used()",
        function_name: "mark_auth_refresh_token_used",
      },
    ]);
  });
});
