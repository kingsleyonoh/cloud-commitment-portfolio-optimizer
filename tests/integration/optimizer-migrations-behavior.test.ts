import { resolve } from "node:path";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runMigrations } from "../../core/db/migrations.js";
import {
  insertActivePriceVersion,
  insertCompletedForecastRun,
  insertOptimizerPolicy,
  insertOptimizerRun,
  insertOptimizerTenant,
  insertRecommendation,
  insertScenario,
} from "./helpers/optimizer-schema.js";
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
let forecastA: string;
let forecastB: string;
let priceA: string;
let priceB: string;
let policyA: string;
let policyB: string;

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_optimizer_behavior");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  client = new Client({ connectionString: database.url });
  await client.connect();
  tenantA = await insertOptimizerTenant(client, "optimizer tenant a");
  tenantB = await insertOptimizerTenant(client, "optimizer tenant b");
  forecastA = await insertCompletedForecastRun(client, tenantA, "optimizer-a");
  forecastB = await insertCompletedForecastRun(client, tenantB, "optimizer-b");
  priceA = await insertActivePriceVersion(client, tenantA, "a");
  priceB = await insertActivePriceVersion(client, tenantB, "b");
  policyA = (await insertOptimizerPolicy(client, tenantA, "risk bounded")).rows[0]!.id;
  policyB = (await insertOptimizerPolicy(client, tenantB, "risk bounded")).rows[0]!.id;
  await client.query("UPDATE optimizer_policies SET status = 'active' WHERE id = ANY($1::uuid[])", [
    [policyA, policyB],
  ]);
});

afterAll(async () => {
  if (client) await client.end();
  await dropIsolatedDatabase(database);
});

describe("optimizer policy ownership and freeze rules", () => {
  it("allows duplicate policy names across tenants and freezes active policies", async () => {
    const archiveCandidate = await insertOptimizerPolicy(client, tenantA, "archive candidate");
    await client.query("UPDATE optimizer_policies SET status = 'active' WHERE id = $1", [
      archiveCandidate.rows[0]!.id,
    ]);
    await expect(insertOptimizerPolicy(client, tenantA, "risk bounded")).rejects.toMatchObject({
      constraint: "optimizer_policies_name_key",
    });
    await expect(insertOptimizerPolicy(client, tenantB, "risk bounded")).rejects.toMatchObject({
      constraint: "optimizer_policies_name_key",
    });
    await expect(
      client.query("UPDATE optimizer_policies SET max_downside_loss_cents = 1 WHERE id = $1", [
        policyA,
      ]),
    ).rejects.toMatchObject({ code: "55000", message: "active optimizer policy is frozen" });
    await expect(
      client.query("UPDATE optimizer_policies SET status = 'archived' WHERE id = $1", [
        archiveCandidate.rows[0]!.id,
      ]),
    ).resolves.toBeDefined();
  });

  it("rejects invalid objective, money, utilization, instrument, and config boundaries", async () => {
    const draft = await insertOptimizerPolicy(client, tenantA, "invalid draft");
    await expect(
      client.query("UPDATE optimizer_policies SET objective = 'headline_savings' WHERE id = $1", [
        draft.rows[0]!.id,
      ]),
    ).rejects.toMatchObject({ constraint: "optimizer_policies_objective_check" });
    await expect(
      client.query("UPDATE optimizer_policies SET max_downside_loss_cents = -1 WHERE id = $1", [
        draft.rows[0]!.id,
      ]),
    ).rejects.toMatchObject({ constraint: "optimizer_policies_cents_check" });
    await expect(
      client.query("UPDATE optimizer_policies SET max_utilization_gap_pct = 100.01 WHERE id = $1", [
        draft.rows[0]!.id,
      ]),
    ).rejects.toMatchObject({ constraint: "optimizer_policies_utilization_gap_check" });
    await expect(
      client.query(
        "UPDATE optimizer_policies SET allowed_instruments = ARRAY['spot']::text[] WHERE id = $1",
        [draft.rows[0]!.id],
      ),
    ).rejects.toMatchObject({ constraint: "optimizer_policies_allowed_instruments_check" });
  });
});

describe("optimizer run frozen-input authority", () => {
  it("requires same-tenant completed forecasts, active policies, and active frozen price versions", async () => {
    await expect(
      insertOptimizerRun(client, tenantA, forecastB, policyA, [priceA]),
    ).rejects.toMatchObject({ constraint: "optimizer_runs_tenant_forecast_fkey" });
    await expect(
      insertOptimizerRun(client, tenantA, forecastA, policyB, [priceA]),
    ).rejects.toMatchObject({ constraint: "optimizer_runs_tenant_policy_fkey" });
    await expect(
      insertOptimizerRun(client, tenantA, forecastA, policyA, [priceB]),
    ).rejects.toMatchObject({ code: "55000", message: "optimizer run price versions are invalid" });
    await expect(
      insertOptimizerRun(client, tenantA, forecastA, policyA, [priceA]),
    ).resolves.toBeDefined();
  });

  it("freezes run inputs and enforces terminal state details", async () => {
    const run = await insertOptimizerRun(client, tenantA, forecastA, policyA, [priceA]);
    await expect(
      client.query("UPDATE optimizer_runs SET random_seed = random_seed + 1 WHERE id = $1", [
        run.rows[0]!.id,
      ]),
    ).rejects.toMatchObject({ code: "55000", message: "optimizer run inputs are immutable" });
    await client.query("UPDATE optimizer_runs SET status = 'running' WHERE id = $1", [
      run.rows[0]!.id,
    ]);
    await expect(
      client.query("UPDATE optimizer_runs SET status = 'completed' WHERE id = $1", [
        run.rows[0]!.id,
      ]),
    ).rejects.toMatchObject({ constraint: "optimizer_runs_state_fields_check" });
  });

  it("accepts only ready same-tenant scenarios when present", async () => {
    const scenario = await insertScenario(client, tenantA, "ready");
    await expect(
      insertOptimizerRun(client, tenantA, forecastA, policyA, [priceA], scenario.rows[0]!.id),
    ).rejects.toMatchObject({ code: "55000", message: "optimizer runs require a ready scenario" });
    await client.query("UPDATE scenarios SET status = 'ready' WHERE id = $1", [
      scenario.rows[0]!.id,
    ]);
    await expect(
      insertOptimizerRun(client, tenantA, forecastA, policyA, [priceA], scenario.rows[0]!.id),
    ).resolves.toBeDefined();
  });
});

describe("recommendation economic identity", () => {
  it("persists exact cents and risk decimals under the same tenant optimizer run", async () => {
    const run = await insertOptimizerRun(client, tenantA, forecastA, policyA, [priceA]);
    const recommendation = await insertRecommendation(client, tenantA, run.rows[0]!.id);
    const stored = await client.query<{
      expected_savings_cents: string;
      p95_downside_loss_cents: string;
      confidence_score: string;
    }>(
      "SELECT expected_savings_cents, p95_downside_loss_cents, confidence_score FROM recommendations WHERE id = $1",
      [recommendation.rows[0]!.id],
    );
    expect(stored.rows[0]).toEqual({
      expected_savings_cents: "180000",
      p95_downside_loss_cents: "40000",
      confidence_score: "0.9400",
    });
  });

  it("rejects cross-tenant optimizer runs and impossible risk/economic values", async () => {
    const run = await insertOptimizerRun(client, tenantA, forecastA, policyA, [priceA]);
    await expect(insertRecommendation(client, tenantB, run.rows[0]!.id)).rejects.toMatchObject({
      constraint: "recommendations_tenant_run_fkey",
    });
    await expect(
      client.query(
        `INSERT INTO recommendations
          (tenant_id, optimizer_run_id, recommendation_type, provider, instrument, service_code,
           region, term_months, commitment_amount_cents, expected_savings_cents,
           p95_downside_loss_cents, utilization_p50_pct, utilization_p95_pct, confidence_score,
           risk_band, status, explanation, approval_required)
         VALUES ($1, $2, 'buy', 'aws', 'aws_compute_savings_plan', 'AmazonEC2', 'us-east-1',
                 12, -1, 0, 0, 50, 101, 1.5000, 'low', 'draft', '{}'::jsonb, false)`,
        [tenantA, run.rows[0]!.id],
      ),
    ).rejects.toMatchObject({ constraint: "recommendations_economics_check" });
  });
});
