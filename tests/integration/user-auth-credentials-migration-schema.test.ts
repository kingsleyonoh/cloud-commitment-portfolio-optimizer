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
  ["user_id", "uuid", "NO", null],
  ["tenant_id", "uuid", "NO", null],
  ["password_hash", "text", "NO", null],
  ["password_changed_at", "timestamp with time zone", "NO", "now()"],
  ["created_at", "timestamp with time zone", "NO", "now()"],
  ["updated_at", "timestamp with time zone", "NO", "now()"],
] as const;
let database: IsolatedDatabase | undefined;
let client: Client;

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_user_credentials_schema");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  client = new Client({ connectionString: database.url });
  await client.connect();
});

afterAll(async () => {
  if (client) await client.end();
  await dropIsolatedDatabase(database);
});

describe("separate user authentication credentials schema", () => {
  it("owns the exact ordered six-column PostgreSQL contract", async () => {
    const result = await client.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'user_auth_credentials'
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

  it("has exactly the named ownership, verifier, and chronology constraints", async () => {
    const result = await client.query<{
      name: string;
      type: string;
      delete_action: string;
      definition: string;
    }>(`
      SELECT conname AS name, contype AS type, confdeltype AS delete_action,
             pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'user_auth_credentials'::regclass ORDER BY conname
    `);
    expect(result.rows.map(({ name, type }) => [name, type])).toEqual([
      ["user_auth_credentials_password_hash_check", "c"],
      ["user_auth_credentials_pkey", "p"],
      ["user_auth_credentials_tenant_id_fkey", "f"],
      ["user_auth_credentials_tenant_user_fkey", "f"],
      ["user_auth_credentials_tenant_user_key", "u"],
      ["user_auth_credentials_timestamps_ordered_check", "c"],
    ]);
    const constraints = new Map(result.rows.map((row) => [row.name, row]));
    expect(constraints.get("user_auth_credentials_tenant_id_fkey")).toMatchObject({
      delete_action: "r",
      definition: "FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT",
    });
    expect(constraints.get("user_auth_credentials_tenant_user_fkey")).toMatchObject({
      delete_action: "r",
      definition:
        "FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE RESTRICT",
    });
    expect(constraints.get("user_auth_credentials_password_hash_check")?.definition).toMatch(
      /btrim\(password_hash\).*octet_length\(password_hash\) <= 512.*argon2id.*v=19/iu,
    );
  });

  it("has only the primary and tenant-leading unique indexes", async () => {
    const result = await client.query<{ indexname: string; indexdef: string }>(`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'user_auth_credentials'
      ORDER BY indexname
    `);
    expect(result.rows).toEqual([
      {
        indexname: "user_auth_credentials_pkey",
        indexdef:
          "CREATE UNIQUE INDEX user_auth_credentials_pkey ON public.user_auth_credentials USING btree (user_id)",
      },
      {
        indexname: "user_auth_credentials_tenant_user_key",
        indexdef:
          "CREATE UNIQUE INDEX user_auth_credentials_tenant_user_key ON public.user_auth_credentials USING btree (tenant_id, user_id)",
      },
    ]);
  });

  it("owns one scoped BEFORE UPDATE timestamp trigger and function", async () => {
    const result = await client.query<{
      name: string;
      definition: string;
      function_name: string;
    }>(`
      SELECT tgname AS name, pg_get_triggerdef(pg_trigger.oid) AS definition,
             pg_proc.proname AS function_name
      FROM pg_trigger JOIN pg_proc ON pg_proc.oid = pg_trigger.tgfoid
      WHERE tgrelid = 'user_auth_credentials'::regclass AND NOT tgisinternal
      ORDER BY tgname
    `);
    expect(result.rows).toEqual([
      {
        name: "user_auth_credentials_set_updated_at",
        definition:
          "CREATE TRIGGER user_auth_credentials_set_updated_at BEFORE UPDATE ON public.user_auth_credentials FOR EACH ROW EXECUTE FUNCTION set_user_auth_credentials_updated_at()",
        function_name: "set_user_auth_credentials_updated_at",
      },
    ]);
  });

  it("starts empty and has no sensitive or redundant columns", async () => {
    const rows = await client.query<{ count: string }>(
      "SELECT count(*) FROM user_auth_credentials",
    );
    const columns = expectedColumns.map(([name]) => name);
    expect(rows.rows[0]?.count).toBe("0");
    expect(columns).not.toEqual(
      expect.arrayContaining([
        "password",
        "plaintext",
        "algorithm",
        "version",
        "memory_cost",
        "time_cost",
        "parallelism",
        "salt",
        "reset_token",
        "session_token",
      ]),
    );
  });
});
