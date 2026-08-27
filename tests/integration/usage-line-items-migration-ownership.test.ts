import { randomUUID } from "node:crypto";
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

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_usage_line_items_ownership");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  client = new Client({ connectionString: database.url });
  await client.connect();
});

afterAll(async () => {
  if (client) await client.end();
  await dropIsolatedDatabase(database);
});

describe("same-tenant usage ownership", () => {
  it("accepts exact owned batch and account references", async () => {
    const owners = await insertUsageOwners(client, "usage-owner");
    await expect(insertUsageItem(client, owners)).resolves.toBeDefined();
  });

  it("rejects absent and cross-tenant tenant, batch, and account owners", async () => {
    const tenantA = await insertUsageOwners(client, "usage-tenant-a");
    const tenantB = await insertUsageOwners(client, "usage-tenant-b");
    await expect(
      insertUsageItem(client, { ...tenantA, tenantId: randomUUID() }),
    ).rejects.toMatchObject({ constraint: "usage_line_items_tenant_id_fkey" });
    await expect(
      insertUsageItem(client, { ...tenantA, batchId: tenantB.batchId }),
    ).rejects.toMatchObject({ constraint: "usage_line_items_tenant_import_batch_fkey" });
    await expect(
      insertUsageItem(client, { ...tenantA, accountId: tenantB.accountId }),
    ).rejects.toMatchObject({ constraint: "usage_line_items_tenant_cloud_account_fkey" });
  });

  it("restricts deletion of referenced batch and independent account owners", async () => {
    const batchOwners = await insertUsageOwners(client, "usage-batch-delete");
    await insertUsageItem(client, batchOwners);
    await expect(
      client.query("DELETE FROM import_batches WHERE id = $1", [batchOwners.batchId]),
    ).rejects.toMatchObject({ constraint: "usage_line_items_tenant_import_batch_fkey" });

    const accountOwners = await insertUsageOwners(client, "usage-account-delete", "aws", false);
    await insertUsageItem(client, accountOwners);
    await expect(
      client.query("DELETE FROM cloud_accounts WHERE id = $1", [accountOwners.accountId]),
    ).rejects.toMatchObject({ constraint: "usage_line_items_tenant_cloud_account_fkey" });
  });

  it("is insert-only and preserves immutable economics", async () => {
    const owners = await insertUsageOwners(client, "usage-immutable");
    const id = (await insertUsageItem(client, owners)).rows[0]!.id;
    await expect(
      client.query("UPDATE usage_line_items SET realized_cost_cents = '1' WHERE id = $1", [id]),
    ).rejects.toMatchObject({ code: "55000", message: "usage_line_items are immutable" });
    await expect(
      client.query("DELETE FROM usage_line_items WHERE id = $1", [id]),
    ).rejects.toMatchObject({ code: "55000", message: "usage_line_items are immutable" });
    const stored = await client.query<{ realized_cost_cents: string }>(
      "SELECT realized_cost_cents FROM usage_line_items WHERE id = $1",
      [id],
    );
    expect(stored.rows).toEqual([{ realized_cost_cents: "18" }]);
  });

  it("returns only rows from the selected tenant", async () => {
    const tenantA: UsageOwners = await insertUsageOwners(client, "usage-isolation-a");
    const tenantB: UsageOwners = await insertUsageOwners(client, "usage-isolation-b");
    const rowA = (await insertUsageItem(client, tenantA)).rows[0]!.id;
    await insertUsageItem(client, tenantB);
    const result = await client.query<{ id: string }>(
      "SELECT id FROM usage_line_items WHERE tenant_id = $1",
      [tenantA.tenantId],
    );
    expect(result.rows).toEqual([{ id: rowA }]);
  });
});
