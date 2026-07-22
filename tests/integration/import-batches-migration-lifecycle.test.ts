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
let tenantId: string;
let accountId: string;
let userId: string;

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_import_batches_lifecycle");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  client = new Client({ connectionString: database.url });
  await client.connect();
  tenantId = await insertImportTenant(client, "Import lifecycle tenant");
  accountId = await insertImportAccount(client, tenantId, "lifecycle-account");
  userId = await insertImportUser(client, tenantId, "lifecycle-user");
});

afterAll(async () => {
  if (client) await client.end();
  await dropIsolatedDatabase(database);
});

async function insertBatch(
  status?: string,
  lineCount = "0",
  errorDetails = "{}",
  parserWarnings = "[]",
) {
  return client.query<{
    id: string;
    status: string;
    line_count: string;
    error_details: object;
    parser_warnings: unknown[];
    created_at: Date;
    updated_at: Date;
  }>(
    `INSERT INTO import_batches
       (tenant_id, cloud_account_id, source, format, status, object_uri, schema_version,
        line_count, error_details, parser_warnings, created_by_user_id)
     VALUES ($1, $2, $3, $4, COALESCE($5, 'queued'), $6, $7, $8, $9::jsonb, $10::jsonb, $11)
     RETURNING id, status, line_count, error_details, parser_warnings, created_at, updated_at`,
    [
      tenantId,
      accountId,
      validImportMetadata.source,
      validImportMetadata.format,
      status ?? null,
      validImportMetadata.objectUri,
      validImportMetadata.schemaVersion,
      lineCount,
      errorDetails,
      parserWarnings,
      userId,
    ],
  );
}

describe("canonical import batch lifecycle", () => {
  it("starts a metadata-only batch queued with empty counts and parser outcomes", async () => {
    const row = (await insertBatch()).rows[0]!;
    expect(row).toMatchObject({
      status: "queued",
      line_count: "0",
      error_details: {},
      parser_warnings: [],
    });
    expect(row.updated_at).toEqual(row.created_at);
  });

  it.each([
    ["processing", "0", "{}", "[]"],
    ["completed", "12", "{}", '[{"code":"optional_column_ignored"}]'],
    ["failed", "0", '{"code":"parser_failed"}', "[]"],
    ["quarantined", "7", '{"code":"required_field_missing"}', '[{"code":"schema_drift"}]'],
    ["cancelled", "0", '{"code":"operator_cancelled"}', "[]"],
  ])("accepts canonical %s metadata coupling", async (status, count, errors, warnings) => {
    const row = (await insertBatch(status, count, errors, warnings)).rows[0]!;
    expect(row.status).toBe(status);
    expect(row.line_count).toBe(count);
  });

  it("advances database-managed updated_at while preserving created_at", async () => {
    const queued = (await insertBatch()).rows[0]!;
    await client.query("SELECT pg_sleep(0.02)");
    const updated = await client.query<{ created_at: Date; updated_at: Date; status: string }>(
      `UPDATE import_batches SET status = 'processing', updated_at = '2000-01-01T00:00:00Z'
       WHERE tenant_id = $1 AND id = $2 RETURNING created_at, updated_at, status`,
      [tenantId, queued.id],
    );
    expect(updated.rows[0]).toMatchObject({ created_at: queued.created_at, status: "processing" });
    expect(updated.rows[0]!.updated_at.getTime()).toBeGreaterThan(queued.updated_at.getTime());
  });
});
