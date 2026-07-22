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
  ["idempotency_key_hash", "bytea", "NO", null],
  ["request_sha256", "bytea", "NO", null],
  ["status", "text", "NO", "'pending'::text"],
  ["tenant_id", "uuid", "YES", null],
  ["api_key_id", "uuid", "YES", null],
  ["error_code", "text", "YES", null],
  ["created_at", "timestamp with time zone", "NO", "now()"],
  ["updated_at", "timestamp with time zone", "NO", "now()"],
] as const;

let database: IsolatedDatabase | undefined;
let client: Client;

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_registration_schema");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  client = new Client({ connectionString: database.url });
  await client.connect();
});

afterAll(async () => {
  if (client) await client.end();
  await dropIsolatedDatabase(database);
});

describe("registration request durable ledger schema", () => {
  it("owns the exact ordered nine-column PostgreSQL contract and defaults", async () => {
    const result = await client.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'registration_requests'
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

  it("has only named digest, state, ownership, and result constraints", async () => {
    const result = await client.query<{
      name: string;
      type: string;
      delete_action: string;
      definition: string;
    }>(`
      SELECT conname AS name, contype AS type, confdeltype AS delete_action,
             pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'registration_requests'::regclass
      ORDER BY conname
    `);

    expect(result.rows.map(({ name, type }) => [name, type])).toEqual([
      ["registration_requests_api_key_id_fkey", "f"],
      ["registration_requests_error_code_trimmed_check", "c"],
      ["registration_requests_failed_state_check", "c"],
      ["registration_requests_idempotency_key_hash_32_bytes_check", "c"],
      ["registration_requests_idempotency_key_hash_key", "u"],
      ["registration_requests_pending_state_check", "c"],
      ["registration_requests_pkey", "p"],
      ["registration_requests_request_sha256_32_bytes_check", "c"],
      ["registration_requests_result_api_key_tenant_fkey", "f"],
      ["registration_requests_status_check", "c"],
      ["registration_requests_succeeded_state_check", "c"],
      ["registration_requests_tenant_id_fkey", "f"],
    ]);
    const byName = new Map(result.rows.map((constraint) => [constraint.name, constraint]));
    expect(byName.get("registration_requests_tenant_id_fkey")).toMatchObject({
      delete_action: "r",
      definition: "FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT",
    });
    expect(byName.get("registration_requests_api_key_id_fkey")).toMatchObject({
      delete_action: "r",
      definition: "FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE RESTRICT",
    });
    expect(byName.get("registration_requests_result_api_key_tenant_fkey")).toMatchObject({
      delete_action: "r",
      definition:
        "FOREIGN KEY (tenant_id, api_key_id) REFERENCES api_keys(tenant_id, id) ON DELETE RESTRICT",
    });
    expect(
      byName.get("registration_requests_idempotency_key_hash_32_bytes_check")?.definition,
    ).toContain("octet_length(idempotency_key_hash) = 32");
    expect(byName.get("registration_requests_request_sha256_32_bytes_check")?.definition).toContain(
      "octet_length(request_sha256) = 32",
    );
    expect(byName.get("registration_requests_status_check")?.definition).toMatch(
      /status = ANY \(ARRAY\['pending'.*'succeeded'.*'failed'/u,
    );
    expect(byName.get("registration_requests_error_code_trimmed_check")?.definition).toMatch(
      /error_code IS NULL.*error_code = btrim\(error_code\).*error_code <> ''/u,
    );
  });

  it("has exact ledger indexes and the documented ownership-support index", async () => {
    const result = await client.query<{ indexname: string; indexdef: string }>(`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename IN ('api_keys', 'registration_requests')
        AND indexname IN (
          'api_keys_tenant_id_id_key',
          'registration_requests_idempotency_key_hash_key',
          'registration_requests_pkey',
          'registration_requests_status_created_at_idx'
        )
      ORDER BY indexname
    `);

    expect(result.rows).toEqual([
      {
        indexname: "api_keys_tenant_id_id_key",
        indexdef:
          "CREATE UNIQUE INDEX api_keys_tenant_id_id_key ON public.api_keys USING btree (tenant_id, id)",
      },
      {
        indexname: "registration_requests_idempotency_key_hash_key",
        indexdef:
          "CREATE UNIQUE INDEX registration_requests_idempotency_key_hash_key ON public.registration_requests USING btree (idempotency_key_hash)",
      },
      {
        indexname: "registration_requests_pkey",
        indexdef:
          "CREATE UNIQUE INDEX registration_requests_pkey ON public.registration_requests USING btree (id)",
      },
      {
        indexname: "registration_requests_status_created_at_idx",
        indexdef:
          "CREATE INDEX registration_requests_status_created_at_idx ON public.registration_requests USING btree (status, created_at)",
      },
    ]);
  });

  it("owns one scoped database-managed update trigger", async () => {
    const result = await client.query<{ trigger_name: string; action_statement: string }>(`
      SELECT trigger_name, action_statement
      FROM information_schema.triggers
      WHERE event_object_schema = 'public' AND event_object_table = 'registration_requests'
      ORDER BY trigger_name
    `);
    expect(result.rows).toEqual([
      {
        trigger_name: "registration_requests_set_updated_at",
        action_statement: "EXECUTE FUNCTION set_registration_requests_updated_at()",
      },
    ]);
  });

  it("starts empty and exposes no raw or sensitive persistence columns", async () => {
    const rows = await client.query<{ count: string }>(
      "SELECT count(*) FROM registration_requests",
    );
    const columns = expectedColumns.map(([name]) => name);
    expect(rows.rows[0]?.count).toBe("0");
    expect(columns).not.toEqual(
      expect.arrayContaining([
        "idempotency_key",
        "request_body",
        "plaintext_api_key",
        "key_hash",
        "response_body",
        "client_ip",
        "credential",
        "secret",
      ]),
    );
  });
});
