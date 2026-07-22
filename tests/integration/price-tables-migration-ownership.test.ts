import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runMigrations } from "../../core/db/migrations.js";
import {
  insertPriceItem,
  insertPriceTenant,
  insertPriceVersion,
} from "./helpers/price-tables-schema.js";
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

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_price_tables_ownership");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  client = new Client({ connectionString: database.url });
  await client.connect();
  tenantA = await insertPriceTenant(client, "price ownership tenant a");
  tenantB = await insertPriceTenant(client, "price ownership tenant b");
});

afterAll(async () => {
  if (client) await client.end();
  await dropIsolatedDatabase(database);
});

function digest(label: string): string {
  return createHash("sha256").update(`ownership:${label}`).digest("hex");
}

async function version(label: string, tenantId = tenantA) {
  const result = await insertPriceVersion(client, tenantId, {
    versionLabel: label,
    checksum: digest(`${tenantId}:${label}`),
  });
  return result.rows[0]!;
}

describe("tenant and version identity ownership", () => {
  it("allows the same label and checksum in another tenant only", async () => {
    const shared = digest("shared-source");
    await insertPriceVersion(client, tenantA, { versionLabel: "shared", checksum: shared });
    await expect(
      insertPriceVersion(client, tenantB, { versionLabel: "shared", checksum: shared }),
    ).resolves.toBeDefined();
    await expect(
      insertPriceVersion(client, tenantA, { versionLabel: "shared", checksum: digest("other") }),
    ).rejects.toMatchObject({ constraint: "price_table_versions_tenant_version_label_key" });
    await expect(
      insertPriceVersion(client, tenantA, { versionLabel: "other", checksum: shared }),
    ).rejects.toMatchObject({ constraint: "price_table_versions_tenant_checksum_key" });
  });

  it("rejects absent and cross-tenant item ownership and provider identity", async () => {
    const owned = await version("owned-version");
    await expect(insertPriceItem(client, randomUUID(), owned.id)).rejects.toMatchObject({
      constraint: "price_table_items_tenant_id_fkey",
    });
    await expect(insertPriceItem(client, tenantB, owned.id)).rejects.toMatchObject({
      constraint: "price_table_items_tenant_version_fkey",
    });
    await expect(
      insertPriceItem(client, tenantA, owned.id, {
        provider: "azure",
        instrument: "azure_reservation",
      }),
    ).rejects.toMatchObject({ constraint: "price_table_items_tenant_version_fkey" });
  });

  it("prevents duplicate canonical dimension rows within one version", async () => {
    const first = await version("duplicate-dimensions");
    await insertPriceItem(client, tenantA, first.id);
    await expect(insertPriceItem(client, tenantA, first.id)).rejects.toMatchObject({
      constraint: "price_table_items_tenant_dimensions_key",
    });
    const second = await version("same-dimensions-new-version");
    await expect(insertPriceItem(client, tenantA, second.id)).resolves.toBeDefined();
  });

  it("restricts parent tenant and version deletion", async () => {
    const created = await version("parent-delete");
    await insertPriceItem(client, tenantA, created.id);
    await expect(
      client.query("DELETE FROM price_table_versions WHERE id = $1", [created.id]),
    ).rejects.toMatchObject({ code: "55000", message: "price table versions cannot be deleted" });
    await expect(
      client.query("DELETE FROM tenants WHERE id = $1", [tenantA]),
    ).rejects.toMatchObject({
      constraint: "price_table_versions_tenant_id_fkey",
    });
  });
});
