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
const modelColumns = [
  ["id", "uuid", "NO", "gen_random_uuid()"],
  ["tenant_id", "uuid", "NO", null],
  ["name", "text", "NO", null],
  ["provider_scope", "ARRAY", "NO", null],
  ["service_scope", "ARRAY", "NO", null],
  ["horizon_months", "integer", "NO", null],
  ["method", "text", "NO", null],
  ["config", "jsonb", "NO", "'{}'::jsonb"],
  ["status", "text", "NO", "'draft'::text"],
  ["created_by_user_id", "uuid", "YES", null],
  ["created_at", "timestamp with time zone", "NO", "now()"],
  ["updated_at", "timestamp with time zone", "NO", "now()"],
] as const;
const runColumns = [
  ["id", "uuid", "NO", "gen_random_uuid()"],
  ["tenant_id", "uuid", "NO", null],
  ["forecast_model_id", "uuid", "NO", null],
  ["status", "text", "NO", "'queued'::text"],
  ["input_window_start", "date", "NO", null],
  ["input_window_end", "date", "NO", null],
  ["horizon_months", "integer", "NO", null],
  ["random_seed", "bigint", "NO", null],
  ["output_uri", "text", "YES", null],
  ["quality_metrics", "jsonb", "NO", "'{}'::jsonb"],
  ["error_details", "jsonb", "NO", "'{}'::jsonb"],
  ["created_at", "timestamp with time zone", "NO", "now()"],
  ["updated_at", "timestamp with time zone", "NO", "now()"],
] as const;
let database: IsolatedDatabase | undefined;
let client: Client;

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_forecast_schema");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  client = new Client({ connectionString: database.url });
  await client.connect();
});

afterAll(async () => {
  if (client) await client.end();
  await dropIsolatedDatabase(database);
});

async function columns(table: string) {
  const result = await client.query(
    `SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
    [table],
  );
  return result.rows.map((row) => Object.values(row));
}

async function constraints(table: string) {
  return client.query<{ name: string; type: string; definition: string }>(`
    SELECT conname AS name, contype AS type, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint WHERE conrelid = '${table}'::regclass ORDER BY conname
  `);
}

describe("exact PRD 4.8 and 4.9 forecast catalogs", () => {
  it("owns only the ordered canonical model and run columns", async () => {
    expect(await columns("forecast_models")).toEqual(modelColumns);
    expect(await columns("forecast_runs")).toEqual(runColumns);
  });

  it("has exact tenant ownership, model identity, scope, config, and status checks", async () => {
    const result = await constraints("forecast_models");
    expect(result.rows.map(({ name, type }) => [name, type])).toEqual([
      ["forecast_models_config_object_check", "c"],
      ["forecast_models_created_by_tenant_fkey", "f"],
      ["forecast_models_horizon_months_check", "c"],
      ["forecast_models_method_check", "c"],
      ["forecast_models_name_canonical_check", "c"],
      ["forecast_models_pkey", "p"],
      ["forecast_models_provider_scope_check", "c"],
      ["forecast_models_service_scope_check", "c"],
      ["forecast_models_status_check", "c"],
      ["forecast_models_tenant_id_fkey", "f"],
      ["forecast_models_tenant_name_key", "u"],
      ["forecast_models_timestamps_ordered_check", "c"],
    ]);
  });

  it("has exact run ownership, deterministic inputs, state, JSON, and time checks", async () => {
    const result = await constraints("forecast_runs");
    expect(result.rows.map(({ name, type }) => [name, type])).toEqual([
      ["forecast_runs_error_details_object_check", "c"],
      ["forecast_runs_horizon_months_check", "c"],
      ["forecast_runs_input_window_check", "c"],
      ["forecast_runs_output_uri_canonical_check", "c"],
      ["forecast_runs_pkey", "p"],
      ["forecast_runs_quality_metrics_object_check", "c"],
      ["forecast_runs_state_fields_check", "c"],
      ["forecast_runs_status_check", "c"],
      ["forecast_runs_tenant_id_fkey", "f"],
      ["forecast_runs_tenant_model_fkey", "f"],
      ["forecast_runs_timestamps_ordered_check", "c"],
    ]);
  });

  it("has only canonical query indexes plus identity support", async () => {
    const result = await client.query<{ tablename: string; indexname: string }>(`
      SELECT tablename, indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename IN ('forecast_models', 'forecast_runs')
      ORDER BY tablename, indexname
    `);
    expect(result.rows).toEqual([
      { tablename: "forecast_models", indexname: "forecast_models_pkey" },
      { tablename: "forecast_models", indexname: "forecast_models_tenant_identity_key" },
      { tablename: "forecast_models", indexname: "forecast_models_tenant_name_key" },
      { tablename: "forecast_models", indexname: "forecast_models_tenant_status_created_idx" },
      { tablename: "forecast_runs", indexname: "forecast_runs_pkey" },
      { tablename: "forecast_runs", indexname: "forecast_runs_tenant_id_id_key" },
      { tablename: "forecast_runs", indexname: "forecast_runs_tenant_model_status_created_idx" },
      { tablename: "forecast_runs", indexname: "forecast_runs_tenant_window_created_idx" },
    ]);
  });

  it("installs scoped lifecycle triggers and creates no rows", async () => {
    const triggers = await client.query(`
      SELECT c.relname AS table_name, t.tgname AS name, p.proname AS function_name
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE c.relname IN ('forecast_models', 'forecast_runs') AND NOT t.tgisinternal
      ORDER BY c.relname, t.tgname
    `);
    expect(triggers.rows).toEqual([
      {
        table_name: "forecast_models",
        name: "forecast_models_enforce_lifecycle",
        function_name: "enforce_forecast_model_lifecycle",
      },
      {
        table_name: "forecast_runs",
        name: "forecast_runs_enforce_lifecycle",
        function_name: "enforce_forecast_run_lifecycle",
      },
    ]);
    const counts = await client.query(`
      SELECT (SELECT count(*)::text FROM forecast_models) AS models,
             (SELECT count(*)::text FROM forecast_runs) AS runs
    `);
    expect(counts.rows[0]).toEqual({ models: "0", runs: "0" });
  });
});
