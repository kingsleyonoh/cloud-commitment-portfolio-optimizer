import { resolve } from "node:path";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runMigrations } from "../../core/db/migrations.js";
import {
  insertForecastModel,
  insertForecastRun,
  insertForecastTenant,
  insertForecastUser,
} from "./helpers/forecast-schema.js";
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
let modelA: string;
let modelB: string;

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_forecast_runs_behavior");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  client = new Client({ connectionString: database.url });
  await client.connect();
  tenantA = await insertForecastTenant(client, "forecast run tenant a");
  tenantB = await insertForecastTenant(client, "forecast run tenant b");
  const userA = await insertForecastUser(client, tenantA, "forecast-run-a");
  const userB = await insertForecastUser(client, tenantB, "forecast-run-b");
  modelA = (await insertForecastModel(client, tenantA, userA, { name: "Run model A" })).rows[0]!.id;
  modelB = (await insertForecastModel(client, tenantB, userB, { name: "Run model B" })).rows[0]!.id;
  await client.query("UPDATE forecast_models SET status = 'active' WHERE id = ANY($1::uuid[])", [
    [modelA, modelB],
  ]);
});

afterAll(async () => {
  if (client) await client.end();
  await dropIsolatedDatabase(database);
});

describe("forecast run ownership and deterministic inputs", () => {
  it("accepts signed BIGINT seed boundaries and returns exact decimal strings", async () => {
    const minimum = await insertForecastRun(client, tenantA, modelA, {
      randomSeed: "-9223372036854775808",
    });
    const maximum = await insertForecastRun(client, tenantA, modelA, {
      randomSeed: "9223372036854775807",
      inputWindowStart: "2024-01-01",
      inputWindowEnd: "2024-12-31",
    });
    expect(minimum.rows[0]?.random_seed).toBe("-9223372036854775808");
    expect(maximum.rows[0]?.random_seed).toBe("9223372036854775807");
  });

  it("rejects cross-tenant model ownership and restricts parent deletion", async () => {
    await expect(insertForecastRun(client, tenantA, modelB)).rejects.toMatchObject({
      code: "23503",
      constraint: "forecast_runs_tenant_model_fkey",
    });
    const created = await insertForecastRun(client, tenantA, modelA, {
      inputWindowStart: "2023-01-01",
      inputWindowEnd: "2023-12-31",
    });
    await expect(
      client.query("DELETE FROM forecast_models WHERE id = $1", [modelA]),
    ).rejects.toMatchObject({ code: "55000" });
    expect(created.rows).toHaveLength(1);
  });

  it.each([
    [
      { inputWindowStart: "2026-02-01", inputWindowEnd: "2026-01-01" },
      "forecast_runs_input_window_check",
    ],
    [{ horizonMonths: "2" }, "forecast_runs_horizon_months_check"],
    [{ qualityMetrics: "[]" }, "forecast_runs_quality_metrics_object_check"],
    [{ errorDetails: "[]" }, "forecast_runs_error_details_object_check"],
  ])("rejects invalid run boundary %#", async (overrides, constraint) => {
    await expect(insertForecastRun(client, tenantA, modelA, overrides)).rejects.toMatchObject({
      code: "23514",
      constraint,
    });
  });

  it("rejects direct terminal creation and noncanonical output metadata", async () => {
    await expect(
      insertForecastRun(client, tenantA, modelA, {
        status: "completed",
        outputUri: "forecasts/synthetic/output.parquet",
      }),
    ).rejects.toMatchObject({ code: "23514", message: "forecast runs must be created as queued" });
    await expect(
      insertForecastRun(client, tenantA, modelA, { outputUri: " premature" }),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "forecast_runs_output_uri_canonical_check",
    });
  });
});

describe("forecast run lifecycle and frozen outcomes", () => {
  it("moves queued to running to completed with output and quality metadata", async () => {
    const created = await insertForecastRun(client, tenantA, modelA, {
      inputWindowStart: "2022-01-01",
      inputWindowEnd: "2022-12-31",
    });
    await client.query("UPDATE forecast_runs SET status = 'running' WHERE id = $1", [
      created.rows[0]!.id,
    ]);
    const completed = await client.query<{ status: string; output_uri: string }>(
      `UPDATE forecast_runs
       SET status = 'completed', output_uri = $2, quality_metrics = $3::jsonb
       WHERE id = $1 RETURNING status, output_uri`,
      [created.rows[0]!.id, "forecasts/synthetic/completed.parquet", '{"confidence":"high"}'],
    );
    expect(completed.rows[0]).toEqual({
      status: "completed",
      output_uri: "forecasts/synthetic/completed.parquet",
    });
  });

  it("rejects completed runs without persisted quality metrics", async () => {
    const created = await insertForecastRun(client, tenantA, modelA, {
      inputWindowStart: "2021-01-01",
      inputWindowEnd: "2021-12-31",
    });
    await client.query("UPDATE forecast_runs SET status = 'running' WHERE id = $1", [
      created.rows[0]!.id,
    ]);
    await expect(
      client.query("UPDATE forecast_runs SET status = 'completed', output_uri = $2 WHERE id = $1", [
        created.rows[0]!.id,
        "forecasts/synthetic/missing-metrics.parquet",
      ]),
    ).rejects.toMatchObject({ code: "23514", constraint: "forecast_runs_state_fields_check" });
  });

  it("requires bounded error metadata for failed runs and freezes terminal rows", async () => {
    const created = await insertForecastRun(client, tenantA, modelA, {
      inputWindowStart: "2021-01-01",
      inputWindowEnd: "2021-12-31",
    });
    await expect(
      client.query("UPDATE forecast_runs SET status = 'failed' WHERE id = $1", [
        created.rows[0]!.id,
      ]),
    ).rejects.toMatchObject({ code: "23514", constraint: "forecast_runs_state_fields_check" });
    await client.query(
      `UPDATE forecast_runs SET status = 'failed', error_details = '{"code":"synthetic_failure"}'
       WHERE id = $1`,
      [created.rows[0]!.id],
    );
    await expect(
      client.query("UPDATE forecast_runs SET status = 'queued' WHERE id = $1", [
        created.rows[0]!.id,
      ]),
    ).rejects.toMatchObject({ code: "55000", message: "forecast run is terminal" });
  });

  it("rejects deterministic input mutation and ordinary deletion", async () => {
    const created = await insertForecastRun(client, tenantA, modelA, {
      inputWindowStart: "2020-01-01",
      inputWindowEnd: "2020-12-31",
    });
    await expect(
      client.query("UPDATE forecast_runs SET random_seed = random_seed + 1 WHERE id = $1", [
        created.rows[0]!.id,
      ]),
    ).rejects.toMatchObject({ code: "55000", message: "forecast run inputs are immutable" });
    await expect(
      client.query("DELETE FROM forecast_runs WHERE id = $1", [created.rows[0]!.id]),
    ).rejects.toMatchObject({ code: "55000", message: "forecast runs cannot be deleted" });
  });

  it("uses both exact tenant-leading query indexes", async () => {
    await client.query("SET enable_seqscan = off");
    const byModel = await client.query<{ "QUERY PLAN": string }>(
      `EXPLAIN (FORMAT TEXT) SELECT * FROM forecast_runs
       WHERE tenant_id = $1 AND forecast_model_id = $2 AND status = 'queued'
       ORDER BY created_at`,
      [tenantA, modelA],
    );
    const byWindow = await client.query<{ "QUERY PLAN": string }>(
      `EXPLAIN (FORMAT TEXT) SELECT * FROM forecast_runs
       WHERE tenant_id = $1 AND input_window_end >= DATE '2020-01-01' ORDER BY created_at`,
      [tenantA],
    );
    await client.query("RESET enable_seqscan");
    expect(byModel.rows.map((row) => row["QUERY PLAN"]).join("\n")).toContain(
      "forecast_runs_tenant_model_status_created_idx",
    );
    expect(byWindow.rows.map((row) => row["QUERY PLAN"]).join("\n")).toContain(
      "forecast_runs_tenant_window_created_idx",
    );
  });
});
