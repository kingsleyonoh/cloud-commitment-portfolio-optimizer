import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../core/db/migrations.js";
import {
  insertImportAccount,
  insertImportTenant,
  insertImportUser,
  validImportMetadata,
} from "./helpers/import-batches-schema.js";
import {
  createIsolatedDatabase,
  dropIsolatedDatabase,
  type IsolatedDatabase,
} from "./helpers/postgres-database.js";

const migrationsDirectory = resolve("db/migrations");
let database: IsolatedDatabase | undefined;
let client: Client;

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_import_batches_ownership");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  client = new Client({ connectionString: database.url });
  await client.connect();
});

afterAll(async () => {
  if (client) await client.end();
  await dropIsolatedDatabase(database);
});

async function insertBatch(tenantId: string, accountId: string | null, userId: string | null) {
  return client.query<{ id: string }>(
    `INSERT INTO import_batches
       (tenant_id, cloud_account_id, source, format, object_uri, schema_version,
        created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      tenantId,
      accountId,
      validImportMetadata.source,
      validImportMetadata.format,
      validImportMetadata.objectUri,
      validImportMetadata.schemaVersion,
      userId,
    ],
  );
}

describe("same-tenant import ownership", () => {
  it("accepts matching account and creator while allowing nullable optional attribution", async () => {
    const tenantId = await insertImportTenant(client, "Import owner tenant");
    const accountId = await insertImportAccount(client, tenantId, "owner-account");
    const userId = await insertImportUser(client, tenantId, "owner-user");
    await expect(insertBatch(tenantId, accountId, userId)).resolves.toBeDefined();
    await expect(insertBatch(tenantId, null, null)).resolves.toBeDefined();
  });

  it("rejects cross-tenant account and creator coupling", async () => {
    const tenantA = await insertImportTenant(client, "Import ownership tenant A");
    const tenantB = await insertImportTenant(client, "Import ownership tenant B");
    const accountB = await insertImportAccount(client, tenantB, "tenant-b-account");
    const userB = await insertImportUser(client, tenantB, "tenant-b-user");
    await expect(insertBatch(tenantA, accountB, null)).rejects.toMatchObject({
      constraint: "import_batches_tenant_cloud_account_fkey",
    });
    await expect(insertBatch(tenantA, null, userB)).rejects.toMatchObject({
      constraint: "import_batches_tenant_created_by_user_fkey",
    });
  });

  it("rejects missing owners and restricts tenant, account, and creator deletion", async () => {
    const tenantId = await insertImportTenant(client, "Import restricted owner tenant");
    const accountId = await insertImportAccount(client, tenantId, "restricted-account");
    const userId = await insertImportUser(client, tenantId, "restricted-user");
    await expect(insertBatch(randomUUID(), null, null)).rejects.toMatchObject({
      constraint: "import_batches_tenant_id_fkey",
    });
    await insertBatch(tenantId, accountId, userId);
    await expect(
      client.query("DELETE FROM cloud_accounts WHERE id = $1", [accountId]),
    ).rejects.toMatchObject({ constraint: "import_batches_tenant_cloud_account_fkey" });
    await expect(client.query("DELETE FROM users WHERE id = $1", [userId])).rejects.toMatchObject({
      constraint: "import_batches_tenant_created_by_user_fkey",
    });
    await expect(client.query("DELETE FROM tenants WHERE id = $1", [tenantId])).rejects.toThrow(
      /foreign key/iu,
    );
  });
});

describe("tenant-leading import lookup plans", () => {
  it("uses status and account indexes and returns only the selected tenant", async () => {
    const tenantA = await insertImportTenant(client, "Import query tenant A");
    const tenantB = await insertImportTenant(client, "Import query tenant B");
    const accountA = await insertImportAccount(client, tenantA, "query-account-a");
    const accountB = await insertImportAccount(client, tenantB, "query-account-b");
    const batchA = (await insertBatch(tenantA, accountA, null)).rows[0]!.id;
    await insertBatch(tenantB, accountB, null);
    await client.query("SET enable_seqscan = off");
    const statusPlan = await client.query<{ "QUERY PLAN": string }>(
      `EXPLAIN (COSTS OFF) SELECT id FROM import_batches
       WHERE tenant_id = $1 AND status = 'queued' ORDER BY created_at`,
      [tenantA],
    );
    const accountPlan = await client.query<{ "QUERY PLAN": string }>(
      `EXPLAIN (COSTS OFF) SELECT id FROM import_batches
       WHERE tenant_id = $1 AND cloud_account_id = $2 ORDER BY created_at`,
      [tenantA, accountA],
    );
    const rows = await client.query<{ id: string }>(
      "SELECT id FROM import_batches WHERE tenant_id = $1 AND status = 'queued'",
      [tenantA],
    );
    await client.query("RESET enable_seqscan");
    expect(statusPlan.rows.map((row) => row["QUERY PLAN"]).join("\n")).toContain(
      "import_batches_tenant_status_created_idx",
    );
    expect(accountPlan.rows.map((row) => row["QUERY PLAN"]).join("\n")).toContain(
      "import_batches_tenant_cloud_account_created_idx",
    );
    expect(rows.rows).toEqual([{ id: batchA }]);
  });
});
