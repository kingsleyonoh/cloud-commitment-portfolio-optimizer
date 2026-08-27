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
const tables = ["scenarios", "optimizer_policies", "optimizer_runs", "recommendations"] as const;
let database: IsolatedDatabase | undefined;
let client: Client;

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_optimizer_schema");
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

async function constraintNames(table: string) {
  const result = await client.query<{ name: string; type: string }>(
    `SELECT conname AS name, contype AS type
     FROM pg_constraint WHERE conrelid = $1::regclass ORDER BY conname`,
    [table],
  );
  return result.rows.map(({ name, type }) => [name, type]);
}

describe("exact PRD optimizer data catalogs", () => {
  it("installs only the ordered canonical columns", async () => {
    expect(await columns("scenarios")).toEqual([
      ["id", "uuid", "NO", "gen_random_uuid()"],
      ["tenant_id", "uuid", "NO", null],
      ["name", "text", "NO", null],
      ["description", "text", "YES", null],
      ["base_forecast_run_id", "uuid", "YES", null],
      ["shock_config", "jsonb", "NO", "'{}'::jsonb"],
      ["status", "text", "NO", "'draft'::text"],
      ["created_by_user_id", "uuid", "YES", null],
      ["created_at", "timestamp with time zone", "NO", "now()"],
      ["updated_at", "timestamp with time zone", "NO", "now()"],
    ]);
    expect(await columns("optimizer_policies")).toHaveLength(13);
    expect(await columns("optimizer_runs")).toHaveLength(18);
    expect(await columns("recommendations")).toHaveLength(21);
  });

  it("has tenant ownership, lifecycle, and state constraints on each table", async () => {
    expect(await constraintNames("optimizer_policies")).toEqual([
      ["optimizer_policies_allowed_instruments_check", "c"],
      ["optimizer_policies_cents_check", "c"],
      ["optimizer_policies_config_object_check", "c"],
      ["optimizer_policies_name_check", "c"],
      ["optimizer_policies_name_key", "u"],
      ["optimizer_policies_objective_check", "c"],
      ["optimizer_policies_pkey", "p"],
      ["optimizer_policies_status_check", "c"],
      ["optimizer_policies_tenant_id_fkey", "f"],
      ["optimizer_policies_timestamps_ordered_check", "c"],
      ["optimizer_policies_utilization_gap_check", "c"],
    ]);
    expect(await constraintNames("optimizer_runs")).toContainEqual([
      "optimizer_runs_tenant_policy_fkey",
      "f",
    ]);
    expect(await constraintNames("recommendations")).toContainEqual([
      "recommendations_economics_check",
      "c",
    ]);
  });

  it("has tenant-leading query indexes and no seeded rows", async () => {
    const indexes = await client.query<{ tablename: string; indexname: string }>(
      `SELECT tablename, indexname FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = ANY($1)
       ORDER BY tablename, indexname`,
      [tables],
    );
    expect(indexes.rows.map((row) => row.indexname)).toEqual(
      expect.arrayContaining([
        "scenarios_tenant_status_created_idx",
        "optimizer_policies_tenant_status_idx",
        "optimizer_runs_tenant_status_created_idx",
        "optimizer_runs_tenant_provider_instrument_status_idx",
        "recommendations_tenant_status_risk_created_idx",
        "recommendations_tenant_provider_instrument_region_idx",
      ]),
    );
    for (const table of tables) {
      const count = await client.query<{ count: string }>(`SELECT count(*)::text FROM ${table}`);
      expect(count.rows[0]?.count, table).toBe("0");
    }
  });
});
