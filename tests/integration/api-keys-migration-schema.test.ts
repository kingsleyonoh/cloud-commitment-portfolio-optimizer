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
  ["key_hash", "text", "NO", null],
  ["note", "text", "YES", null],
  ["created_at", "timestamp with time zone", "NO", "now()"],
  ["revoked_at", "timestamp with time zone", "YES", null],
] as const;

let database: IsolatedDatabase | undefined;
let client: Client;

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_api_keys_schema");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  client = new Client({ connectionString: database.url });
  await client.connect();
});

afterAll(async () => {
  if (client) await client.end();
  await dropIsolatedDatabase(database);
});

describe("hashed API-key rotation metadata schema", () => {
  it("owns the exact ordered six-column PostgreSQL contract and defaults", async () => {
    const result = await client.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'api_keys'
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

  it("has only the canonical named constraints", async () => {
    const constraints = await client.query<{
      name: string;
      type: string;
      delete_action: string;
      definition: string;
    }>(`
      SELECT conname AS name, contype AS type, confdeltype AS delete_action,
             pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'api_keys'::regclass
      ORDER BY conname
    `);

    expect(constraints.rows.map(({ name, type }) => [name, type])).toEqual([
      ["api_keys_key_hash_key", "u"],
      ["api_keys_note_trimmed_check", "c"],
      ["api_keys_pkey", "p"],
      ["api_keys_revoked_chronology_check", "c"],
      ["api_keys_tenant_id_fkey", "f"],
    ]);
    expect(constraints.rows.find(({ name }) => name === "api_keys_tenant_id_fkey")).toMatchObject({
      delete_action: "r",
      definition: "FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT",
    });
    expect(
      constraints.rows.find(({ name }) => name === "api_keys_note_trimmed_check")?.definition,
    ).toMatch(/note IS NULL.*note = btrim\(note\).*note <> ''/iu);
    expect(
      constraints.rows.find(({ name }) => name === "api_keys_revoked_chronology_check")?.definition,
    ).toMatch(/revoked_at IS NULL.*revoked_at >= created_at/iu);
  });

  it("has global hash uniqueness plus lookup and result-ownership indexes", async () => {
    const indexes = await client.query<{ indexname: string; indexdef: string }>(`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'api_keys'
      ORDER BY indexname
    `);

    expect(indexes.rows).toEqual([
      {
        indexname: "api_keys_key_hash_key",
        indexdef:
          "CREATE UNIQUE INDEX api_keys_key_hash_key ON public.api_keys USING btree (key_hash)",
      },
      {
        indexname: "api_keys_pkey",
        indexdef: "CREATE UNIQUE INDEX api_keys_pkey ON public.api_keys USING btree (id)",
      },
      {
        indexname: "api_keys_tenant_id_id_key",
        indexdef:
          "CREATE UNIQUE INDEX api_keys_tenant_id_id_key ON public.api_keys USING btree (tenant_id, id)",
      },
      {
        indexname: "api_keys_tenant_revoked_created_idx",
        indexdef:
          "CREATE INDEX api_keys_tenant_revoked_created_idx ON public.api_keys USING btree (tenant_id, revoked_at, created_at)",
      },
    ]);
    expect(
      indexes.rows.filter(({ indexdef }) => /WHERE .*revoked_at IS NULL/iu.test(indexdef)),
    ).toEqual([]);
  });

  it("creates zero key rows and no plaintext credential columns", async () => {
    const rows = await client.query<{ count: string }>("SELECT count(*) FROM api_keys");
    const columns = await client.query<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'api_keys'
      ORDER BY ordinal_position
    `);

    expect(rows.rows[0]?.count).toBe("0");
    expect(columns.rows.map(({ column_name }) => column_name)).toEqual([
      "id",
      "tenant_id",
      "key_hash",
      "note",
      "created_at",
      "revoked_at",
    ]);
    expect(columns.rows.map(({ column_name }) => column_name)).not.toEqual(
      expect.arrayContaining(["api_key", "plaintext", "credential", "secret", "token"]),
    );
  });
});
