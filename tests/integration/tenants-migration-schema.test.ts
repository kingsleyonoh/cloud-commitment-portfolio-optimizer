import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
  ["name", "text", "NO", null],
  ["legal_name", "text", "NO", null],
  ["full_legal_name", "text", "NO", null],
  ["display_name", "text", "NO", null],
  ["address", "jsonb", "NO", "'{}'::jsonb"],
  ["registration", "jsonb", "NO", "'{}'::jsonb"],
  ["contact_email", "text", "YES", null],
  ["contact_phone", "text", "YES", null],
  ["support_url", "text", "YES", null],
  ["finance_owner_email", "text", "YES", null],
  ["wordmark", "text", "YES", null],
  ["default_currency", "text", "NO", "'USD'::text"],
  ["timezone", "text", "NO", "'UTC'::text"],
  ["risk_budget_cents", "bigint", "NO", "0"],
  ["is_active", "boolean", "NO", "true"],
  ["created_at", "timestamp with time zone", "NO", "now()"],
  ["updated_at", "timestamp with time zone", "NO", "now()"],
] as const;

let database: IsolatedDatabase | undefined;
let client: Client;
let temporaryDirectory: string | undefined;

beforeAll(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "ccpo-tenants-schema-"));
  await copyFile(
    join(migrationsDirectory, "0001_create_tenants.sql"),
    join(temporaryDirectory, "0001_create_tenants.sql"),
  );
  database = await createIsolatedDatabase("ccpo_tenants_schema");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory: temporaryDirectory });
  client = new Client({ connectionString: database.url });
  await client.connect();
});

afterAll(async () => {
  if (client) await client.end();
  await dropIsolatedDatabase(database);
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true });
});

describe("credential-free tenants schema", () => {
  it("owns the exact ordered 18-column PostgreSQL contract", async () => {
    const result = await client.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'tenants'
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

  it("has only the sole primary key and canonical active index", async () => {
    const constraints = await client.query<{ name: string; type: string; definition: string }>(`
      SELECT conname AS name, contype AS type, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'tenants'::regclass
      ORDER BY conname
    `);
    const indexes = await client.query<{ indexname: string; indexdef: string }>(`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'tenants'
      ORDER BY indexname
    `);

    expect(constraints.rows.filter(({ type }) => type === "p")).toEqual([
      { name: "tenants_pkey", type: "p", definition: "PRIMARY KEY (id)" },
    ]);
    expect(indexes.rows).toEqual([
      {
        indexname: "tenants_is_active_idx",
        indexdef: "CREATE INDEX tenants_is_active_idx ON public.tenants USING btree (is_active)",
      },
      {
        indexname: "tenants_pkey",
        indexdef: "CREATE UNIQUE INDEX tenants_pkey ON public.tenants USING btree (id)",
      },
    ]);
  });

  it("installs every stable shape check and the database-managed update trigger", async () => {
    const checks = await client.query<{ name: string }>(`
      SELECT conname AS name FROM pg_constraint
      WHERE conrelid = 'tenants'::regclass AND contype = 'c'
      ORDER BY conname
    `);
    const triggers = await client.query<{ name: string; definition: string }>(`
      SELECT tgname AS name, pg_get_triggerdef(oid) AS definition
      FROM pg_trigger
      WHERE tgrelid = 'tenants'::regclass AND NOT tgisinternal
    `);

    expect(checks.rows.map(({ name }) => name)).toEqual([
      "tenants_address_object_check",
      "tenants_contact_email_trimmed_check",
      "tenants_contact_phone_trimmed_check",
      "tenants_currency_shape_check",
      "tenants_display_name_trimmed_check",
      "tenants_finance_owner_email_trimmed_check",
      "tenants_full_legal_name_trimmed_check",
      "tenants_legal_name_trimmed_check",
      "tenants_name_trimmed_check",
      "tenants_registration_object_check",
      "tenants_risk_budget_nonnegative_check",
      "tenants_support_url_trimmed_check",
      "tenants_timestamps_ordered_check",
      "tenants_timezone_trimmed_check",
      "tenants_wordmark_trimmed_check",
    ]);
    expect(triggers.rows).toHaveLength(1);
    expect(triggers.rows[0]).toMatchObject({ name: "tenants_set_updated_at" });
    expect(triggers.rows[0]?.definition).toMatch(/BEFORE UPDATE ON public\.tenants FOR EACH ROW/iu);
  });

  it("creates no tenant rows, credential columns, extensions, or domain tables", async () => {
    const rows = await client.query<{ count: string }>("SELECT count(*) FROM tenants");
    const tables = await client.query<{ tablename: string }>(`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
    `);
    const extensions = await client.query<{ extname: string }>(
      "SELECT extname FROM pg_extension ORDER BY extname",
    );

    expect(rows.rows[0]?.count).toBe("0");
    expect(tables.rows.map(({ tablename }) => tablename)).toEqual([
      "_ccpo_schema_migrations",
      "tenants",
    ]);
    expect(extensions.rows.map(({ extname }) => extname)).toEqual(["plpgsql"]);
  });
});
