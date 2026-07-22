import { resolve } from "node:path";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runMigrations } from "../../core/db/migrations.js";
import {
  insertForecastModel,
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
let userA: string;
let userB: string;

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_forecast_models_behavior");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  client = new Client({ connectionString: database.url });
  await client.connect();
  tenantA = await insertForecastTenant(client, "forecast model tenant a");
  tenantB = await insertForecastTenant(client, "forecast model tenant b");
  userA = await insertForecastUser(client, tenantA, "forecast-model-a");
  userB = await insertForecastUser(client, tenantB, "forecast-model-b");
});

afterAll(async () => {
  if (client) await client.end();
  await dropIsolatedDatabase(database);
});

describe("forecast model ownership and validation", () => {
  it("accepts canonical tenant-owned scopes and isolates names per tenant", async () => {
    const first = await insertForecastModel(client, tenantA, userA, { name: "Shared model" });
    const second = await insertForecastModel(client, tenantB, userB, { name: "Shared model" });
    expect(first.rows[0]?.status).toBe("draft");
    expect(second.rows[0]?.status).toBe("draft");
    await expect(
      insertForecastModel(client, tenantA, userA, { name: "Shared model" }),
    ).rejects.toMatchObject({ code: "23505", constraint: "forecast_models_tenant_name_key" });
  });

  it("rejects cross-tenant creator attribution and restricts owner deletion", async () => {
    await expect(
      insertForecastModel(client, tenantA, userB, { name: "Cross tenant creator" }),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "forecast_models_created_by_tenant_fkey",
    });
    const created = await insertForecastModel(client, tenantA, userA, { name: "Owned model" });
    await expect(client.query("DELETE FROM users WHERE id = $1", [userA])).rejects.toMatchObject({
      code: "23503",
    });
    expect(created.rows).toHaveLength(1);
  });

  it.each([
    [{ providerScope: [] }, "forecast_models_provider_scope_check"],
    [{ providerScope: ["aws", "aws"] }, "forecast_models_provider_scope_check"],
    [{ providerScope: ["AWS"] }, "forecast_models_provider_scope_check"],
    [{ serviceScope: [] }, "forecast_models_service_scope_check"],
    [{ serviceScope: [" padded"] }, "forecast_models_service_scope_check"],
    [{ horizonMonths: "2" }, "forecast_models_horizon_months_check"],
    [{ method: "unknown" }, "forecast_models_method_check"],
    [{ config: "[]" }, "forecast_models_config_object_check"],
  ])("rejects invalid model boundary %#", async (overrides, constraint) => {
    await expect(
      insertForecastModel(client, tenantA, userA, {
        name: `invalid-${constraint}-${JSON.stringify(overrides)}`.slice(0, 190),
        ...overrides,
      }),
    ).rejects.toMatchObject({ code: "23514", constraint });
  });

  it("rejects padded/control names and sensitive top-level config keys", async () => {
    await expect(
      insertForecastModel(client, tenantA, userA, { name: " padded model" }),
    ).rejects.toMatchObject({ code: "23514", constraint: "forecast_models_name_canonical_check" });
    const forbiddenKey = ["pass", "word"].join("");
    await expect(
      insertForecastModel(client, tenantA, userA, {
        name: "Unsafe model config",
        config: JSON.stringify({ [forbiddenKey]: "synthetic" }),
      }),
    ).rejects.toMatchObject({ code: "23514", constraint: "forecast_models_config_object_check" });
  });
});

describe("forecast model lifecycle", () => {
  it("requires draft creation, allows draft edits, then freezes active models", async () => {
    await expect(
      insertForecastModel(client, tenantA, userA, { name: "Direct active", status: "active" }),
    ).rejects.toMatchObject({ code: "23514", message: "forecast models must be created as draft" });
    const created = await insertForecastModel(client, tenantA, userA, { name: "Lifecycle model" });
    await client.query(
      "UPDATE forecast_models SET config = '{\"window\":12}'::jsonb WHERE id = $1",
      [created.rows[0]!.id],
    );
    await client.query("UPDATE forecast_models SET status = 'active' WHERE id = $1", [
      created.rows[0]!.id,
    ]);
    await expect(
      client.query("UPDATE forecast_models SET horizon_months = 24 WHERE id = $1", [
        created.rows[0]!.id,
      ]),
    ).rejects.toMatchObject({ code: "55000", message: "active forecast model is frozen" });
    await client.query("UPDATE forecast_models SET status = 'archived' WHERE id = $1", [
      created.rows[0]!.id,
    ]);
  });

  it("rejects backward/no-op transitions and ordinary deletion", async () => {
    const created = await insertForecastModel(client, tenantA, userA, { name: "Terminal model" });
    await client.query("UPDATE forecast_models SET status = 'active' WHERE id = $1", [
      created.rows[0]!.id,
    ]);
    await expect(
      client.query("UPDATE forecast_models SET status = 'active' WHERE id = $1", [
        created.rows[0]!.id,
      ]),
    ).rejects.toMatchObject({ code: "55000", message: "invalid forecast model status transition" });
    await expect(
      client.query("DELETE FROM forecast_models WHERE id = $1", [created.rows[0]!.id]),
    ).rejects.toMatchObject({ code: "55000", message: "forecast models cannot be deleted" });
  });
});
