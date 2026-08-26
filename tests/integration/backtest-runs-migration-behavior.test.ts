import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runMigrations } from "../../core/db/migrations.js";
import { insertOptimizerPolicy, insertOptimizerTenant } from "./helpers/optimizer-schema.js";
import {
  createIsolatedDatabase,
  dropIsolatedDatabase,
  type IsolatedDatabase,
} from "./helpers/postgres-database.js";

const migrationsDirectory = resolve("db/migrations");
let database: IsolatedDatabase | undefined;
let client: Client;
let tenantA: string;
let tenantB: string;
let policyA: string;
let policyB: string;
let userA: string;
let userB: string;

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_backtest_runs_behavior");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  client = new Client({ connectionString: database.url });
  await client.connect();
  tenantA = await insertOptimizerTenant(client, "backtest tenant a");
  tenantB = await insertOptimizerTenant(client, "backtest tenant b");
  policyA = (await insertOptimizerPolicy(client, tenantA, "backtest policy a")).rows[0]!.id;
  policyB = (await insertOptimizerPolicy(client, tenantB, "backtest policy b")).rows[0]!.id;
  userA = await insertUser(tenantA);
  userB = await insertUser(tenantB);
});

afterAll(async () => {
  if (client) await client.end();
  await dropIsolatedDatabase(database);
});

describe("backtest_runs replay ownership and lifecycle rules", () => {
  it("persists a queued replay identity tied to same-tenant policy and creator", async () => {
    const run = await insertBacktest();
    const stored = await client.query<{
      name: string;
      status: string;
      metrics: unknown;
      error_details: unknown;
    }>("SELECT name, status, metrics, error_details FROM backtest_runs WHERE id = $1", [run]);

    expect(stored.rows[0]).toEqual({
      name: "August replay",
      status: "queued",
      metrics: {},
      error_details: {},
    });
  });

  it("rejects cross-tenant policy/creator, unsafe JSON, invalid windows, and nonqueued inserts", async () => {
    await expect(insertBacktest({ policyId: policyB })).rejects.toMatchObject({
      constraint: "backtest_runs_tenant_policy_fkey",
    });
    await expect(insertBacktest({ createdByUserId: userB })).rejects.toMatchObject({
      constraint: "backtest_runs_tenant_user_fkey",
    });
    await expect(
      insertBacktest({ metrics: { worker_shard_id: "internal" } }),
    ).rejects.toMatchObject({
      constraint: "backtest_runs_metrics_object_check",
    });
    await expect(insertBacktest({ windowStart: "2026-09-01" })).rejects.toMatchObject({
      constraint: "backtest_runs_window_check",
    });
    await expect(insertBacktest({ status: "running" })).rejects.toMatchObject({
      code: "55000",
      message: "backtest runs must start queued",
    });
  });

  it("freezes replay identity and allows one terminal completed or failed outcome", async () => {
    const completed = await insertBacktest({ inputSnapshotUri: "backtests/completed/input.json" });
    await expect(
      client.query("UPDATE backtest_runs SET window_end = '2026-10-01' WHERE id = $1", [completed]),
    ).rejects.toMatchObject({
      code: "55000",
      message: "backtest run replay identity is immutable",
    });
    await client.query("UPDATE backtest_runs SET status = 'running' WHERE id = $1", [completed]);
    await client.query(
      `UPDATE backtest_runs
          SET status = 'completed', output_uri = 'backtests/completed/output.json',
              metrics = '{"net_savings_delta_cents":"250000","regret_cents":"10000"}'::jsonb
        WHERE id = $1`,
      [completed],
    );
    await expect(
      client.query("UPDATE backtest_runs SET status = 'cancelled' WHERE id = $1", [completed]),
    ).rejects.toMatchObject({ code: "55000", message: "backtest run is terminal" });

    const failed = await insertBacktest({ inputSnapshotUri: "backtests/failed/input.json" });
    await client.query("UPDATE backtest_runs SET status = 'running' WHERE id = $1", [failed]);
    await client.query(
      `UPDATE backtest_runs
          SET status = 'failed', error_details = '{"code":"BACKTEST_REPLAY_FAILED"}'::jsonb
        WHERE id = $1`,
      [failed],
    );
    await expect(
      client.query("DELETE FROM backtest_runs WHERE id = $1", [failed]),
    ).rejects.toMatchObject({
      code: "55000",
      message: "backtest runs cannot be deleted",
    });
  });
});

async function insertUser(tenantId: string): Promise<string> {
  return (
    await client.query<{ id: string }>(
      `INSERT INTO users (tenant_id, email, name, role)
       VALUES ($1, $2, 'Backtest User', 'finops_analyst')
       RETURNING id`,
      [tenantId, `backtest-${randomUUID()}@example.invalid`],
    )
  ).rows[0]!.id;
}

async function insertBacktest(overrides: Record<string, unknown> = {}): Promise<string> {
  return (
    await client.query<{ id: string }>(
      `INSERT INTO backtest_runs
         (tenant_id, name, policy_id, baseline, window_start, window_end, status,
          input_snapshot_uri, metrics, error_details, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11)
       RETURNING id`,
      [
        overrides.tenantId ?? tenantA,
        overrides.name ?? "August replay",
        overrides.policyId ?? policyA,
        overrides.baseline ?? "seventy_percent_utilization",
        overrides.windowStart ?? "2026-01-01",
        overrides.windowEnd ?? "2026-08-01",
        overrides.status ?? "queued",
        overrides.inputSnapshotUri ?? "backtests/replay/input.json",
        JSON.stringify(overrides.metrics ?? {}),
        JSON.stringify(overrides.errorDetails ?? {}),
        overrides.createdByUserId ?? userA,
      ],
    )
  ).rows[0]!.id;
}
