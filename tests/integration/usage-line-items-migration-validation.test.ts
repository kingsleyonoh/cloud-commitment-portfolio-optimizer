import { resolve } from "node:path";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runMigrations } from "../../core/db/migrations.js";
import {
  createIsolatedDatabase,
  dropIsolatedDatabase,
  type IsolatedDatabase,
} from "./helpers/postgres-database.js";
import {
  insertUsageItem,
  insertUsageOwners,
  type UsageOwners,
} from "./helpers/usage-line-items-schema.js";

const migrationsDirectory = resolve("db/migrations");
let database: IsolatedDatabase | undefined;
let client: Client;
let owners: UsageOwners;

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_usage_line_items_validation");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  client = new Client({ connectionString: database.url });
  await client.connect();
  owners = await insertUsageOwners(client, "usage-validation");
});

afterAll(async () => {
  if (client) await client.end();
  await dropIsolatedDatabase(database);
});

describe("usage dimensions and tags", () => {
  it.each(["aws", "azure", "gcp"])("accepts canonical provider %s", async (provider) => {
    const matching = await insertUsageOwners(client, `usage-provider-${provider}`, provider);
    await expect(insertUsageItem(client, matching, { provider })).resolves.toBeDefined();
  });

  it.each(["", "AWS", "azure ", "oracle"])("rejects provider %j", async (provider) => {
    await expect(insertUsageItem(client, owners, { provider })).rejects.toMatchObject({
      constraint: "usage_line_items_provider_check",
    });
  });

  it("round-trips canonical Unicode text and object tags exactly", async () => {
    const values = {
      serviceCode: "AmazonÉC2/Σ",
      sku: "sku-地域-001",
      region: "eu-test-Ω",
      usageUnit: "GiB-Hours/Σ",
      tags: '{"team":"FinOps-Ω","nested":{"safe":true}}',
    };
    const id = (await insertUsageItem(client, owners, values)).rows[0]!.id;
    const result = await client.query(
      `SELECT service_code, sku, region, usage_unit, tags
       FROM usage_line_items WHERE id = $1`,
      [id],
    );
    expect(result.rows[0]).toEqual({
      service_code: values.serviceCode,
      sku: values.sku,
      region: values.region,
      usage_unit: values.usageUnit,
      tags: { team: "FinOps-Ω", nested: { safe: true } },
    });
  });

  it.each([
    ["serviceCode", "", "usage_line_items_service_code_canonical_check"],
    ["serviceCode", " AmazonEC2 ", "usage_line_items_service_code_canonical_check"],
    ["sku", "sku\u0001value", "usage_line_items_sku_canonical_check"],
    ["region", " us-east-1", "usage_line_items_region_canonical_check"],
    ["usageUnit", "Hrs\t", "usage_line_items_usage_unit_canonical_check"],
  ])("rejects noncanonical %s value %j", async (field, value, constraint) => {
    await expect(insertUsageItem(client, owners, { [field]: value })).rejects.toMatchObject({
      constraint,
    });
  });

  it.each(["[]", '"metadata"', "null"])("rejects non-object tags %s", async (tags) => {
    await expect(insertUsageItem(client, owners, { tags })).rejects.toMatchObject({
      constraint: "usage_line_items_tags_object_check",
    });
  });

  it("defaults omitted commitment allocation and tags without seed rows", async () => {
    const result = await client.query(
      `
      INSERT INTO usage_line_items
        (tenant_id, import_batch_id, cloud_account_id, provider, service_code, sku,
         region, usage_start, usage_end, usage_quantity, usage_unit,
         on_demand_cost_cents, realized_cost_cents)
      VALUES ($1, $2, $3, 'aws', 'AmazonEC2', 'default-test', 'us-east-1',
              '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z',
              '0.00000001', 'Hrs', '1', '1')
      RETURNING commitment_applied_cents, tags
    `,
      [owners.tenantId, owners.batchId, owners.accountId],
    );
    expect(result.rows[0]).toEqual({ commitment_applied_cents: "0", tags: {} });
  });
});

describe("usage interval and exact economics", () => {
  it("stores NUMERIC(20,8) and BIGINT values as exact decimal strings", async () => {
    const row = (
      await insertUsageItem(client, owners, {
        usageQuantity: "999999999999.12345678",
        onDemandCostCents: "9223372036854775807",
        realizedCostCents: "9223372036854775807",
        commitmentAppliedCents: "9223372036854775807",
      })
    ).rows[0]!;
    expect(row).toMatchObject({
      usage_quantity: "999999999999.12345678",
      on_demand_cost_cents: "9223372036854775807",
      realized_cost_cents: "9223372036854775807",
      commitment_applied_cents: "9223372036854775807",
    });
    expect(typeof row.usage_quantity).toBe("string");
    expect(typeof row.on_demand_cost_cents).toBe("string");
  });

  it.each([
    ["usageQuantity", "-0.00000001", "usage_line_items_usage_quantity_nonnegative_check"],
    ["onDemandCostCents", "-1", "usage_line_items_costs_nonnegative_check"],
    ["realizedCostCents", "-1", "usage_line_items_costs_nonnegative_check"],
    ["commitmentAppliedCents", "-1", "usage_line_items_costs_nonnegative_check"],
    ["commitmentAppliedCents", "25", "usage_line_items_commitment_allocation_check"],
  ])("rejects out-of-domain %s %s", async (field, value, constraint) => {
    await expect(insertUsageItem(client, owners, { [field]: value })).rejects.toMatchObject({
      constraint,
    });
  });

  it.each([
    ["usageQuantity", "1000000000000.00000000"],
    ["onDemandCostCents", "9223372036854775808"],
    ["realizedCostCents", "9223372036854775808"],
  ])("rejects database overflow for %s", async (field, value) => {
    await expect(insertUsageItem(client, owners, { [field]: value })).rejects.toThrow(
      /numeric field overflow|out of range/iu,
    );
  });

  it.each([
    ["2026-01-01T01:00:00Z", "2026-01-01T01:00:00Z"],
    ["2026-01-01T02:00:00Z", "2026-01-01T01:00:00Z"],
  ])("rejects non-positive usage interval %s to %s", async (usageStart, usageEnd) => {
    await expect(insertUsageItem(client, owners, { usageStart, usageEnd })).rejects.toMatchObject({
      constraint: "usage_line_items_usage_period_check",
    });
  });
});
