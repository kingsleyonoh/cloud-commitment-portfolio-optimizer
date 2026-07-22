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
  ["actor_user_id", "uuid", "YES", null],
  ["actor_type", "text", "NO", null],
  ["action", "text", "NO", null],
  ["entity_type", "text", "NO", null],
  ["entity_id", "uuid", "YES", null],
  ["old_values", "jsonb", "YES", null],
  ["new_values", "jsonb", "YES", null],
  ["request_id", "text", "YES", null],
  ["created_at", "timestamp with time zone", "NO", "now()"],
  ["updated_at", "timestamp with time zone", "NO", "now()"],
] as const;

let database: IsolatedDatabase | undefined;
let client: Client;

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_audit_schema");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  client = new Client({ connectionString: database.url });
  await client.connect();
});

afterAll(async () => {
  if (client) await client.end();
  await dropIsolatedDatabase(database);
});

describe("canonical tenant-scoped audit log schema", () => {
  it("owns the exact ordered twelve-column PostgreSQL contract", async () => {
    const result = await client.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'audit_log'
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

  it("has exactly the named primary, tenant, actor, text, JSON, and timestamp constraints", async () => {
    const result = await client.query<{
      name: string;
      type: string;
      delete_action: string;
      definition: string;
    }>(`
      SELECT conname AS name, contype AS type, confdeltype AS delete_action,
             pg_get_constraintdef(oid) AS definition
      FROM pg_constraint WHERE conrelid = 'audit_log'::regclass ORDER BY conname
    `);
    expect(result.rows.map(({ name, type }) => [name, type])).toEqual([
      ["audit_log_action_trimmed_check", "c"],
      ["audit_log_actor_type_check", "c"],
      ["audit_log_actor_user_coupling_check", "c"],
      ["audit_log_entity_type_trimmed_check", "c"],
      ["audit_log_new_values_object_check", "c"],
      ["audit_log_old_values_object_check", "c"],
      ["audit_log_pkey", "p"],
      ["audit_log_request_id_trimmed_check", "c"],
      ["audit_log_tenant_actor_user_fkey", "f"],
      ["audit_log_tenant_id_fkey", "f"],
      ["audit_log_timestamps_equal_check", "c"],
    ]);
    const constraints = new Map(result.rows.map((row) => [row.name, row]));
    expect(constraints.get("audit_log_tenant_id_fkey")).toMatchObject({
      delete_action: "r",
      definition: "FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT",
    });
    expect(constraints.get("audit_log_tenant_actor_user_fkey")).toMatchObject({
      delete_action: "r",
      definition:
        "FOREIGN KEY (tenant_id, actor_user_id) REFERENCES users(tenant_id, id) ON DELETE RESTRICT",
    });
    expect(constraints.get("audit_log_actor_type_check")?.definition).toMatch(
      /actor_type = ANY \(ARRAY\['user'.*'api_key'.*'job'.*'system'/u,
    );
  });

  it("has the exact tenant-leading audit indexes and same-tenant user support", async () => {
    const result = await client.query<{ indexname: string; indexdef: string }>(`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND indexname IN (
        'audit_log_pkey', 'audit_log_tenant_action_created_idx',
        'audit_log_tenant_actor_created_idx', 'audit_log_tenant_entity_created_idx',
        'users_tenant_id_id_key'
      ) ORDER BY indexname
    `);
    expect(result.rows).toEqual([
      {
        indexname: "audit_log_pkey",
        indexdef: "CREATE UNIQUE INDEX audit_log_pkey ON public.audit_log USING btree (id)",
      },
      {
        indexname: "audit_log_tenant_action_created_idx",
        indexdef:
          "CREATE INDEX audit_log_tenant_action_created_idx ON public.audit_log USING btree (tenant_id, action, created_at)",
      },
      {
        indexname: "audit_log_tenant_actor_created_idx",
        indexdef:
          "CREATE INDEX audit_log_tenant_actor_created_idx ON public.audit_log USING btree (tenant_id, actor_user_id, created_at)",
      },
      {
        indexname: "audit_log_tenant_entity_created_idx",
        indexdef:
          "CREATE INDEX audit_log_tenant_entity_created_idx ON public.audit_log USING btree (tenant_id, entity_type, entity_id, created_at)",
      },
      {
        indexname: "users_tenant_id_id_key",
        indexdef:
          "CREATE UNIQUE INDEX users_tenant_id_id_key ON public.users USING btree (tenant_id, id)",
      },
    ]);
  });

  it("owns only the append-only trigger and scoped rejection function", async () => {
    const triggers = await client.query<{
      name: string;
      definition: string;
      function_name: string;
    }>(`
      SELECT tgname AS name, pg_get_triggerdef(pg_trigger.oid) AS definition,
             pg_proc.proname AS function_name
      FROM pg_trigger JOIN pg_proc ON pg_proc.oid = pg_trigger.tgfoid
      WHERE tgrelid = 'audit_log'::regclass AND NOT tgisinternal ORDER BY tgname
    `);
    expect(triggers.rows).toEqual([
      {
        name: "audit_log_append_only_trigger",
        definition:
          "CREATE TRIGGER audit_log_append_only_trigger BEFORE DELETE OR UPDATE ON public.audit_log FOR EACH ROW EXECUTE FUNCTION reject_audit_log_mutation()",
        function_name: "reject_audit_log_mutation",
      },
    ]);
  });

  it("starts empty with no sensitive or extra persistence columns", async () => {
    const rows = await client.query<{ count: string }>("SELECT count(*) FROM audit_log");
    const columns = expectedColumns.map(([name]) => name);
    expect(rows.rows[0]?.count).toBe("0");
    expect(columns).not.toEqual(
      expect.arrayContaining([
        "api_key_id",
        "note",
        "request_body",
        "response_body",
        "authorization",
        "token",
        "credential",
        "secret",
        "key_hash",
      ]),
    );
  });
});
