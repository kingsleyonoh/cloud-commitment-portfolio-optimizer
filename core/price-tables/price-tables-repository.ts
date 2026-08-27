import type { Pool, PoolClient, QueryResultRow } from "pg";

import type {
  PriceTableCreateInput,
  PriceTableListInput,
  PriceTableVersionRecord,
} from "./price-tables-types.js";

export interface PriceTablesRepository {
  create(tenantId: string, input: PriceTableCreateInput): Promise<PriceTableVersionRecord>;
  list(tenantId: string, input: PriceTableListInput): Promise<PriceTableVersionRecord[]>;
  get(tenantId: string, id: string): Promise<PriceTableVersionRecord | null>;
  activate(tenantId: string, id: string): Promise<PriceTableVersionRecord | null>;
  block(tenantId: string, id: string): Promise<PriceTableVersionRecord | null>;
}

interface PriceTableVersionRow extends QueryResultRow {
  id: string;
  provider: PriceTableVersionRecord["provider"];
  instrument: PriceTableVersionRecord["instrument"];
  versionLabel: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  sourceUri: string;
  status: PriceTableVersionRecord["status"];
  checksum: string;
  itemCount: string;
  createdAt: string;
  updatedAt: string;
}

const PROJECTION = `v.id, v.provider, v.instrument,
  v.version_label AS "versionLabel",
  to_char(v.effective_from, 'YYYY-MM-DD') AS "effectiveFrom",
  CASE WHEN v.effective_to IS NULL THEN NULL ELSE to_char(v.effective_to, 'YYYY-MM-DD') END AS "effectiveTo",
  v.source_uri AS "sourceUri", v.status, v.checksum,
  count(i.id)::text AS "itemCount",
  to_char(v.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt",
  to_char(v.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt"`;

export function createPriceTablesRepository(pool: Pool): PriceTablesRepository {
  return {
    create: (tenantId, input) =>
      withTenantTransaction(pool, tenantId, (client) => create(client, tenantId, input)),
    list: (tenantId, input) => list(pool, tenantId, input),
    get: (tenantId, id) => get(pool, tenantId, id),
    activate: (tenantId, id) => transition(pool, tenantId, id, "active"),
    block: (tenantId, id) => transition(pool, tenantId, id, "blocked"),
  };
}

async function create(
  client: PoolClient,
  tenantId: string,
  input: PriceTableCreateInput,
): Promise<PriceTableVersionRecord> {
  const version = await client.query<{ id: string }>(
    `INSERT INTO price_table_versions
       (tenant_id, provider, instrument, version_label, effective_from, effective_to,
        source_uri, status, checksum)
     VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, 'draft', $8)
     RETURNING id`,
    [
      tenantId,
      input.provider,
      input.instrument,
      input.versionLabel,
      input.effectiveFrom,
      input.effectiveTo,
      input.sourceUri,
      input.checksum,
    ],
  );
  const versionId = version.rows[0]!.id;
  for (const item of input.items) {
    await client.query(
      `INSERT INTO price_table_items
         (tenant_id, price_table_version_id, provider, instrument, sku, region,
          term_months, payment_option, hourly_rate_cents, upfront_cents, coverage_rules)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::bigint, $10::bigint, $11::jsonb)`,
      [
        tenantId,
        versionId,
        input.provider,
        input.instrument,
        item.sku,
        item.region,
        item.termMonths,
        item.paymentOption,
        item.hourlyRateCents,
        item.upfrontCents,
        JSON.stringify(item.coverageRules),
      ],
    );
  }
  return (await getWithClient(client, tenantId, versionId))!;
}

async function list(
  pool: Pool,
  tenantId: string,
  input: PriceTableListInput,
): Promise<PriceTableVersionRecord[]> {
  const result = await pool.query<PriceTableVersionRow>(
    `SELECT ${PROJECTION}
       FROM price_table_versions v
       LEFT JOIN price_table_items i
         ON i.tenant_id = v.tenant_id AND i.price_table_version_id = v.id
      WHERE v.tenant_id = $1
        AND ($2::text IS NULL OR v.provider = $2)
        AND ($3::text IS NULL OR v.instrument = $3)
        AND ($4::text IS NULL OR v.status = $4)
        AND ($5::timestamptz IS NULL OR (v.created_at, v.id) < ($5::timestamptz, $6::uuid))
      GROUP BY v.id
      ORDER BY v.created_at DESC, v.id DESC
      LIMIT $7`,
    [
      tenantId,
      input.provider ?? null,
      input.instrument ?? null,
      input.status ?? null,
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
  id: string,
): Promise<PriceTableVersionRecord | null> {
  return await getWithPool(pool, tenantId, id);
}

async function transition(
  pool: Pool,
  tenantId: string,
  id: string,
  status: "active" | "blocked",
): Promise<PriceTableVersionRecord | null> {
  const result = await pool.query<PriceTableVersionRow>(
    `UPDATE price_table_versions SET status = $3
      WHERE tenant_id = $1 AND id = $2
      RETURNING id`,
    [tenantId, id, status],
  );
  if (result.rowCount !== 1) return null;
  return await getWithPool(pool, tenantId, id);
}

async function getWithPool(
  pool: Pool,
  tenantId: string,
  id: string,
): Promise<PriceTableVersionRecord | null> {
  const result = await pool.query<PriceTableVersionRow>(
    `SELECT ${PROJECTION}
       FROM price_table_versions v
       LEFT JOIN price_table_items i
         ON i.tenant_id = v.tenant_id AND i.price_table_version_id = v.id
      WHERE v.tenant_id = $1 AND v.id = $2
      GROUP BY v.id`,
    [tenantId, id],
  );
  return result.rows[0] ? freezeRow(result.rows[0]) : null;
}

async function getWithClient(
  client: PoolClient,
  tenantId: string,
  id: string,
): Promise<PriceTableVersionRecord | null> {
  const result = await client.query<PriceTableVersionRow>(
    `SELECT ${PROJECTION}
       FROM price_table_versions v
       LEFT JOIN price_table_items i
         ON i.tenant_id = v.tenant_id AND i.price_table_version_id = v.id
      WHERE v.tenant_id = $1 AND v.id = $2
      GROUP BY v.id`,
    [tenantId, id],
  );
  return result.rows[0] ? freezeRow(result.rows[0]) : null;
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

function freezeRow(row: PriceTableVersionRow): PriceTableVersionRecord {
  return Object.freeze({
    id: row.id,
    provider: row.provider,
    instrument: row.instrument,
    versionLabel: row.versionLabel,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    sourceUri: row.sourceUri,
    status: row.status,
    checksum: row.checksum,
    itemCount: row.itemCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
