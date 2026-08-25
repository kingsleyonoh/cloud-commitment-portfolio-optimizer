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
let database: IsolatedDatabase | undefined;
let client: Client;

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_report_snapshots_schema");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  client = new Client({ connectionString: database.url });
  await client.connect();
});

afterAll(async () => {
  if (client) await client.end();
  await dropIsolatedDatabase(database);
});

describe("report snapshots PostgreSQL catalog", () => {
  it("owns the exact ordered PRD columns", async () => {
    const result = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'report_snapshots'
      ORDER BY ordinal_position
    `);

    expect(result.rows.map((row) => Object.values(row))).toEqual([
      ["id", "uuid", "NO", "gen_random_uuid()"],
      ["tenant_id", "uuid", "NO", null],
      ["source_type", "text", "NO", null],
      ["source_id", "uuid", "NO", null],
      ["snapshot_json", "jsonb", "NO", null],
      ["rendered_html_uri", "text", "YES", null],
      ["rendered_pdf_uri", "text", "YES", null],
      ["status", "text", "NO", "'queued'::text"],
      ["created_by_user_id", "uuid", "YES", null],
      ["created_at", "timestamp with time zone", "NO", "now()"],
      ["updated_at", "timestamp with time zone", "NO", "now()"],
    ]);
  });

  it("has the exact ownership, state, and query objects", async () => {
    const constraints = await client.query<{ name: string; type: string }>(`
      SELECT conname AS name, contype AS type
      FROM pg_constraint
      WHERE conrelid = 'report_snapshots'::regclass
      ORDER BY conname
    `);
    const indexes = await client.query<{ indexname: string }>(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'report_snapshots'
      ORDER BY indexname
    `);
    const triggers = await client.query<{ name: string; function_name: string }>(`
      SELECT tgname AS name, proname AS function_name
      FROM pg_trigger
      JOIN pg_proc ON pg_proc.oid = pg_trigger.tgfoid
      WHERE tgrelid = 'report_snapshots'::regclass AND NOT tgisinternal
      ORDER BY tgname
    `);

    expect(constraints.rows.map(({ name, type }) => [name, type])).toEqual([
      ["report_snapshots_pkey", "p"],
      ["report_snapshots_rendered_uri_check", "c"],
      ["report_snapshots_snapshot_json_object_check", "c"],
      ["report_snapshots_source_type_check", "c"],
      ["report_snapshots_status_check", "c"],
      ["report_snapshots_tenant_id_fkey", "f"],
      ["report_snapshots_tenant_user_fkey", "f"],
      ["report_snapshots_timestamps_ordered_check", "c"],
      ["report_snapshots_uri_text_check", "c"],
    ]);
    expect(indexes.rows.map(({ indexname }) => indexname)).toEqual([
      "report_snapshots_pkey",
      "report_snapshots_tenant_source_idx",
      "report_snapshots_tenant_status_created_idx",
    ]);
    expect(triggers.rows).toEqual([
      {
        name: "report_snapshots_enforce_lifecycle",
        function_name: "enforce_report_snapshot_lifecycle",
      },
    ]);
  });

  it("creates no report rows", async () => {
    const count = await client.query<{ count: string }>(
      "SELECT count(*)::text FROM report_snapshots",
    );

    expect(count.rows[0]?.count).toBe("0");
  });
});
