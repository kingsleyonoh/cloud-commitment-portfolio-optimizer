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
  database = await createIsolatedDatabase("ccpo_approvals_schema");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  client = new Client({ connectionString: database.url });
  await client.connect();
});

afterAll(async () => {
  if (client) await client.end();
  await dropIsolatedDatabase(database);
});

describe("approvals PostgreSQL catalog", () => {
  it("owns the exact ordered PRD columns", async () => {
    const result = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'approvals'
      ORDER BY ordinal_position
    `);

    expect(result.rows.map((row) => Object.values(row))).toEqual([
      ["id", "uuid", "NO", "gen_random_uuid()"],
      ["tenant_id", "uuid", "NO", null],
      ["recommendation_id", "uuid", "NO", null],
      ["status", "text", "NO", "'queued'::text"],
      ["requested_by_user_id", "uuid", "YES", null],
      ["assigned_to_user_id", "uuid", "YES", null],
      ["workflow_execution_id", "text", "YES", null],
      ["decision_reason", "text", "YES", null],
      ["approval_snapshot", "jsonb", "NO", null],
      ["requested_at", "timestamp with time zone", "NO", "now()"],
      ["decided_at", "timestamp with time zone", "YES", null],
      ["expires_at", "timestamp with time zone", "NO", null],
      ["created_at", "timestamp with time zone", "NO", "now()"],
      ["updated_at", "timestamp with time zone", "NO", "now()"],
    ]);
  });

  it("has exact ownership, state, snapshot, and query objects", async () => {
    const constraints = await client.query<{ name: string; type: string }>(`
      SELECT conname AS name, contype AS type
      FROM pg_constraint
      WHERE conrelid = 'approvals'::regclass
      ORDER BY conname
    `);
    const indexes = await client.query<{ indexname: string }>(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'approvals'
      ORDER BY indexname
    `);
    const triggers = await client.query<{ name: string; function_name: string }>(`
      SELECT tgname AS name, proname AS function_name
      FROM pg_trigger
      JOIN pg_proc ON pg_proc.oid = pg_trigger.tgfoid
      WHERE tgrelid = 'approvals'::regclass AND NOT tgisinternal
      ORDER BY tgname
    `);

    expect(constraints.rows.map(({ name, type }) => [name, type])).toEqual([
      ["approvals_decision_reason_check", "c"],
      ["approvals_pkey", "p"],
      ["approvals_snapshot_object_check", "c"],
      ["approvals_status_check", "c"],
      ["approvals_tenant_assigned_user_fkey", "f"],
      ["approvals_tenant_id_fkey", "f"],
      ["approvals_tenant_recommendation_fkey", "f"],
      ["approvals_tenant_requested_user_fkey", "f"],
      ["approvals_timestamps_ordered_check", "c"],
      ["approvals_workflow_execution_id_check", "c"],
    ]);
    expect(indexes.rows.map(({ indexname }) => indexname)).toEqual([
      "approvals_pkey",
      "approvals_recommendation_state_key",
      "approvals_tenant_recommendation_idx",
      "approvals_tenant_status_expires_idx",
    ]);
    expect(triggers.rows).toEqual([
      { name: "approvals_enforce_lifecycle", function_name: "enforce_approval_lifecycle" },
    ]);
  });

  it("creates no approval rows", async () => {
    const count = await client.query<{ count: string }>("SELECT count(*)::text FROM approvals");

    expect(count.rows[0]?.count).toBe("0");
  });
});
