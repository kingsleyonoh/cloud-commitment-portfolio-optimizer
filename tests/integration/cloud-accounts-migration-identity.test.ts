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

const migrationsDirectory = resolve("db/migrations");
let database: IsolatedDatabase | undefined;
let client: Client;

async function insertTenant(label: string): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO tenants (name, legal_name, full_legal_name, display_name)
     VALUES ($1, $1, $1, $1) RETURNING id`,
    [label],
  );
  return result.rows[0]!.id;
}

async function insertAccount(
  tenantId: string,
  provider: string,
  externalRef: string,
  displayName = "Synthetic account",
  currency = "USD",
) {
  return client.query<{ id: string; is_active: boolean; tags: object }>(
    `INSERT INTO cloud_accounts (tenant_id, provider, external_ref, display_name, currency)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, is_active, tags`,
    [tenantId, provider, externalRef, displayName, currency],
  );
}

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_cloud_accounts_identity");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  client = new Client({ connectionString: database.url });
  await client.connect();
});

afterAll(async () => {
  if (client) await client.end();
  await dropIsolatedDatabase(database);
});

describe("cloud account provider identity and defaults", () => {
  it.each(["aws", "azure", "gcp"])("accepts canonical %s provider identity", async (provider) => {
    const tenantId = await insertTenant(`Provider ${provider} tenant`);
    const result = await insertAccount(tenantId, provider, `synthetic-${provider}-account`);
    expect(result.rows[0]).toMatchObject({ is_active: true, tags: {} });
    expect(result.rows[0]!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/u);
  });

  it.each(["", "AWS", "azure ", " gcp", "oracle"])(
    "rejects noncanonical or unsupported provider %j",
    async (provider) => {
      const tenantId = await insertTenant(`Invalid provider ${JSON.stringify(provider)}`);
      await expect(insertAccount(tenantId, provider, "synthetic-invalid-provider")).rejects.toThrow(
        /cloud_accounts_provider_check/iu,
      );
    },
  );

  it.each(["", "   ", " synthetic-padded-account ", "Synthetic-Mixed-Case"])(
    "rejects noncanonical account identity %j",
    async (externalRef) => {
      const tenantId = await insertTenant(`Invalid account ${JSON.stringify(externalRef)}`);
      await expect(insertAccount(tenantId, "aws", externalRef)).rejects.toThrow(
        /cloud_accounts_external_ref_canonical_check/iu,
      );
    },
  );

  it("rejects duplicate provider identity within a tenant", async () => {
    const tenantId = await insertTenant("Duplicate account tenant");
    await insertAccount(tenantId, "aws", "synthetic-shared-account");
    await expect(
      insertAccount(tenantId, "aws", "synthetic-shared-account", "Duplicate display"),
    ).rejects.toMatchObject({
      constraint: "cloud_accounts_tenant_provider_external_ref_key",
    });
  });

  it("allows the same canonical account identity across tenants and distinct providers", async () => {
    const tenantA = await insertTenant("Shared identity tenant A");
    const tenantB = await insertTenant("Shared identity tenant B");
    const externalRef = "synthetic-shared-provider-account";
    await insertAccount(tenantA, "aws", externalRef, "Tenant A AWS");
    await expect(insertAccount(tenantB, "aws", externalRef, "Tenant B AWS")).resolves.toBeDefined();
    await expect(
      insertAccount(tenantA, "azure", externalRef, "Tenant A Azure"),
    ).resolves.toBeDefined();
    await expect(insertAccount(tenantA, "gcp", externalRef, "Tenant A GCP")).resolves.toBeDefined();
  });
});

describe("cloud account ownership", () => {
  it("enforces the tenant foreign key and restricts deletion of an owning tenant", async () => {
    const tenantId = await insertTenant("Restricted cloud account tenant");
    await insertAccount(tenantId, "aws", "synthetic-restricted-account");
    await expect(
      insertAccount(randomUUID(), "aws", "synthetic-orphan-account"),
    ).rejects.toMatchObject({ constraint: "cloud_accounts_tenant_id_fkey" });
    await expect(
      client.query("DELETE FROM tenants WHERE id = $1", [tenantId]),
    ).rejects.toMatchObject({ constraint: "cloud_accounts_tenant_id_fkey" });
  });
});
