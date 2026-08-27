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
  database = await createIsolatedDatabase("ccpo_backtest_runs_schema");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  client = new Client({ connectionString: database.url });
  await client.connect();
});

afterAll(async () => {
  if (client) await client.end();
  await dropIsolatedDatabase(database);
});

describe("backtest_runs PostgreSQL catalog", () => {
  it("creates the exact replay table columns", async () => {
    const columns = await client.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'backtest_runs'
      ORDER BY ordinal_position
    `);

    expect(
      columns.rows.map(({ column_name, data_type, is_nullable }) => [
        column_name,
        data_type,
        is_nullable,
      ]),
    ).toEqual([
      ["id", "uuid", "NO"],
      ["tenant_id", "uuid", "NO"],
      ["name", "text", "NO"],
      ["policy_id", "uuid", "NO"],
      ["baseline", "text", "NO"],
      ["window_start", "date", "NO"],
      ["window_end", "date", "NO"],
      ["status", "text", "NO"],
      ["input_snapshot_uri", "text", "NO"],
      ["output_uri", "text", "YES"],
      ["metrics", "jsonb", "NO"],
      ["error_details", "jsonb", "NO"],
      ["created_by_user_id", "uuid", "YES"],
      ["created_at", "timestamp with time zone", "NO"],
      ["updated_at", "timestamp with time zone", "NO"],
    ]);
    expect(columns.rows.find((row) => row.column_name === "status")?.column_default).toBe(
      "'queued'::text",
    );
    expect(columns.rows.find((row) => row.column_name === "metrics")?.column_default).toBe(
      "'{}'::jsonb",
    );
  });

  it("has ownership, validation, lifecycle trigger, and replay indexes", async () => {
    const constraints = await client.query<{ conname: string; contype: string }>(`
      SELECT conname, contype
      FROM pg_constraint
      WHERE conrelid = 'backtest_runs'::regclass
      ORDER BY conname
    `);
    const indexes = await client.query<{ indexname: string }>(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'backtest_runs'
      ORDER BY indexname
    `);
    const triggers = await client.query<{ name: string; function_name: string }>(`
      SELECT tgname AS name, p.proname AS function_name
      FROM pg_trigger t
      JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE t.tgrelid = 'backtest_runs'::regclass AND NOT t.tgisinternal
      ORDER BY tgname
    `);

    expect(constraints.rows.map(({ conname, contype }) => [conname, contype])).toEqual([
      ["backtest_runs_baseline_check", "c"],
      ["backtest_runs_completion_check", "c"],
      ["backtest_runs_error_details_object_check", "c"],
      ["backtest_runs_metrics_object_check", "c"],
      ["backtest_runs_name_check", "c"],
      ["backtest_runs_pkey", "p"],
      ["backtest_runs_status_check", "c"],
      ["backtest_runs_tenant_id_fkey", "f"],
      ["backtest_runs_tenant_policy_fkey", "f"],
      ["backtest_runs_tenant_user_fkey", "f"],
      ["backtest_runs_timestamps_ordered_check", "c"],
      ["backtest_runs_uri_text_check", "c"],
      ["backtest_runs_window_check", "c"],
    ]);
    expect(indexes.rows.map(({ indexname }) => indexname)).toEqual([
      "backtest_runs_pkey",
      "backtest_runs_tenant_policy_window_idx",
      "backtest_runs_tenant_status_created_idx",
    ]);
    expect(triggers.rows).toEqual([
      { name: "backtest_runs_enforce_lifecycle", function_name: "enforce_backtest_run_lifecycle" },
    ]);
  });

  it("creates no backtest rows", async () => {
    const count = await client.query<{ count: string }>("SELECT count(*)::text FROM backtest_runs");
    expect(count.rows[0]?.count).toBe("0");
  });
});
