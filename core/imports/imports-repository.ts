import type { Pool, PoolClient, QueryResultRow } from "pg";

import type {
  ImportBatchListInput,
  ImportBatchRecord,
  ImportCreateInput,
  ImportParseResult,
} from "./imports-types.js";

export interface ImportCloudAccountRecord {
  id: string;
  provider: "aws" | "azure" | "gcp";
  isActive: boolean;
}

export interface ImportsRepository {
  getCloudAccount(
    tenantId: string,
    cloudAccountId: string,
  ): Promise<ImportCloudAccountRecord | null>;
  list(tenantId: string, input: ImportBatchListInput): Promise<ImportBatchRecord[]>;
  get(tenantId: string, importBatchId: string): Promise<ImportBatchRecord | null>;
  createImport(input: {
    tenantId: string;
    createdByUserId: string | null;
    create: ImportCreateInput;
    parseResult: ImportParseResult;
  }): Promise<ImportBatchRecord>;
}

interface ImportBatchRow extends QueryResultRow {
  id: string;
  cloudAccountId: string | null;
  source: ImportBatchRecord["source"];
  format: ImportBatchRecord["format"];
  status: ImportBatchRecord["status"];
  objectUri: string;
  schemaVersion: string;
  lineCount: string;
  errorDetails: Record<string, unknown>;
  parserWarnings: Record<string, unknown>[];
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

const PROJECTION = `id, cloud_account_id AS "cloudAccountId", source, format, status,
  object_uri AS "objectUri", schema_version AS "schemaVersion", line_count::text AS "lineCount",
  error_details AS "errorDetails", parser_warnings AS "parserWarnings",
  created_by_user_id AS "createdByUserId",
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt",
  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt"`;

export function createImportsRepository(pool: Pool): ImportsRepository {
  return {
    getCloudAccount: (tenantId, cloudAccountId) => getCloudAccount(pool, tenantId, cloudAccountId),
    list: (tenantId, input) => list(pool, tenantId, input),
    get: (tenantId, importBatchId) => get(pool, tenantId, importBatchId),
    createImport: (input) =>
      withTenantTransaction(pool, input.tenantId, (client) => createImport(client, input)),
  };
}

async function list(
  pool: Pool,
  tenantId: string,
  input: ImportBatchListInput,
): Promise<ImportBatchRecord[]> {
  const result = await pool.query<ImportBatchRow>(
    `SELECT ${PROJECTION}
       FROM import_batches
      WHERE tenant_id = $1
        AND ($2::text IS NULL OR source = $2)
        AND ($3::text IS NULL OR format = $3)
        AND ($4::text IS NULL OR status = $4)
        AND ($5::uuid IS NULL OR cloud_account_id = $5)
        AND ($6::timestamptz IS NULL OR (created_at, id) < ($6::timestamptz, $7::uuid))
      ORDER BY created_at DESC, id DESC
      LIMIT $8`,
    [
      tenantId,
      input.source ?? null,
      input.format ?? null,
      input.status ?? null,
      input.cloudAccountId ?? null,
      input.cursor?.createdAt ?? null,
      input.cursor?.id ?? null,
      input.limit + 1,
    ],
  );
  return result.rows.map(freezeRow);
}

async function get(
  pool: Pool,
  tenantId: string,
  importBatchId: string,
): Promise<ImportBatchRecord | null> {
  const result = await pool.query<ImportBatchRow>(
    `SELECT ${PROJECTION}
       FROM import_batches
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, importBatchId],
  );
  return result.rows[0] ? freezeRow(result.rows[0]) : null;
}

async function getCloudAccount(
  pool: Pool,
  tenantId: string,
  cloudAccountId: string,
): Promise<ImportCloudAccountRecord | null> {
  const result = await pool.query<{
    id: string;
    provider: "aws" | "azure" | "gcp";
    isActive: boolean;
  }>(
    `SELECT id, provider, is_active AS "isActive"
       FROM cloud_accounts
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, cloudAccountId],
  );
  return result.rows[0] ? Object.freeze(result.rows[0]) : null;
}

async function createImport(
  client: PoolClient,
  input: {
    tenantId: string;
    createdByUserId: string | null;
    create: ImportCreateInput;
    parseResult: ImportParseResult;
  },
): Promise<ImportBatchRecord> {
  const batch = await client.query<{ id: string }>(
    `INSERT INTO import_batches
       (tenant_id, cloud_account_id, source, format, object_uri, schema_version, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      input.tenantId,
      input.create.cloudAccountId,
      input.create.source,
      input.create.format,
      input.create.objectUri,
      schemaVersion(input.create.source, input.create.format),
      input.createdByUserId,
    ],
  );
  const batchId = batch.rows[0]!.id;
  if (input.parseResult.kind === "parsed") {
    for (const row of input.parseResult.parsed.rows) {
      await client.query(
        `INSERT INTO usage_line_items
           (tenant_id, import_batch_id, cloud_account_id, provider, service_code, sku,
            region, usage_start, usage_end, usage_quantity, usage_unit,
            on_demand_cost_cents, realized_cost_cents, commitment_applied_cents, tags)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9::timestamptz,
                 $10::numeric, $11, $12::bigint, $13::bigint, $14::bigint, $15::jsonb)`,
        [
          input.tenantId,
          batchId,
          input.create.cloudAccountId,
          row.provider,
          row.serviceCode,
          row.sku,
          row.region,
          row.usageStart,
          row.usageEnd,
          row.usageQuantity,
          row.usageUnit,
          row.onDemandCostCents,
          row.realizedCostCents,
          row.commitmentAppliedCents,
          JSON.stringify(row.tags),
        ],
      );
    }
    return updateBatch(client, batchId, {
      status: "completed",
      lineCount: input.parseResult.parsed.lineCount,
      errorDetails: {},
      parserWarnings: input.parseResult.parsed.parserWarnings,
    });
  }
  return updateBatch(client, batchId, {
    status: "quarantined",
    lineCount: input.parseResult.lineCount,
    errorDetails: input.parseResult.errorDetails,
    parserWarnings: input.parseResult.parserWarnings,
  });
}

function schemaVersion(
  source: ImportCreateInput["source"],
  format: ImportCreateInput["format"],
): string {
  return `${source}_${format}:v1`;
}

async function updateBatch(
  client: PoolClient,
  batchId: string,
  input: {
    status: "completed" | "quarantined";
    lineCount: number;
    errorDetails: Record<string, unknown>;
    parserWarnings: readonly Record<string, unknown>[];
  },
): Promise<ImportBatchRecord> {
  const result = await client.query<ImportBatchRow>(
    `UPDATE import_batches
        SET status = $2,
            line_count = $3::bigint,
            error_details = $4::jsonb,
            parser_warnings = $5::jsonb
      WHERE id = $1
      RETURNING ${PROJECTION}`,
    [
      batchId,
      input.status,
      input.lineCount,
      JSON.stringify(input.errorDetails),
      JSON.stringify(input.parserWarnings),
    ],
  );
  return freezeRow(result.rows[0]!);
}

async function withTenantTransaction<T>(
  pool: Pool,
  tenantId: string,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tenant = await client.query("SELECT id FROM tenants WHERE id = $1 FOR UPDATE", [
      tenantId,
    ]);
    if (tenant.rowCount !== 1) throw new Error("Authenticated tenant vanished.");
    const value = await operation(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function freezeRow(row: ImportBatchRow): ImportBatchRecord {
  return Object.freeze({
    id: row.id,
    cloudAccountId: row.cloudAccountId,
    source: row.source,
    format: row.format,
    status: row.status,
    objectUri: row.objectUri,
    schemaVersion: row.schemaVersion,
    lineCount: row.lineCount,
    errorDetails: Object.freeze({ ...row.errorDetails }),
    parserWarnings: Object.freeze(
      row.parserWarnings.map((warning) => Object.freeze({ ...warning })),
    ),
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
