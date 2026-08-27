import type { Pool, PoolClient, QueryResultRow } from "pg";

import type {
  CloudAccountCreateInput,
  CloudAccountListInput,
  CloudAccountPatchChanges,
  CloudAccountRecord,
} from "./cloud-accounts-types.js";

export type CloudAccountPatchResult =
  | { kind: "updated"; account: CloudAccountRecord }
  | { kind: "not_found" }
  | { kind: "version_conflict" };

export type CloudAccountDeactivateResult =
  { kind: "updated"; account: CloudAccountRecord } | { kind: "not_found" };

export interface CloudAccountsRepository {
  list(tenantId: string, input: CloudAccountListInput): Promise<CloudAccountRecord[]>;
  create(tenantId: string, input: CloudAccountCreateInput): Promise<CloudAccountRecord>;
  patch(input: {
    tenantId: string;
    accountId: string;
    expectedUpdatedAt: string;
    changes: CloudAccountPatchChanges;
  }): Promise<CloudAccountPatchResult>;
  deactivate(input: { tenantId: string; accountId: string }): Promise<CloudAccountDeactivateResult>;
}

interface CloudAccountRow extends QueryResultRow {
  id: string;
  provider: CloudAccountRecord["provider"];
  externalRef: string;
  displayName: string;
  currency: string;
  tags: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

const PROJECTION = `id, provider, external_ref AS "externalRef", display_name AS "displayName",
  currency, tags, is_active AS "isActive",
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt",
  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt"`;

export function createCloudAccountsRepository(pool: Pool): CloudAccountsRepository {
  return {
    list: (tenantId, input) => list(pool, tenantId, input),
    create: (tenantId, input) => create(pool, tenantId, input),
    patch: (input) => withTenantTransaction(pool, input.tenantId, (client) => patch(client, input)),
    deactivate: (input) =>
      withTenantTransaction(pool, input.tenantId, (client) => deactivate(client, input)),
  };
}

async function list(
  pool: Pool,
  tenantId: string,
  input: CloudAccountListInput,
): Promise<CloudAccountRecord[]> {
  const result = await pool.query<CloudAccountRow>(
    `SELECT ${PROJECTION}
     FROM cloud_accounts
     WHERE tenant_id = $1
       AND ($2::text IS NULL OR provider = $2)
       AND ($3::boolean IS NULL OR is_active = $3)
       AND ($4::timestamptz IS NULL OR (created_at, id) < ($4::timestamptz, $5::uuid))
     ORDER BY created_at DESC, id DESC
     LIMIT $6`,
    [
      tenantId,
      input.provider ?? null,
      input.isActive ?? null,
      input.cursor?.createdAt ?? null,
      input.cursor?.id ?? null,
      input.limit + 1,
    ],
  );
  return result.rows.map(freezeRow);
}

async function create(
  pool: Pool,
  tenantId: string,
  input: CloudAccountCreateInput,
): Promise<CloudAccountRecord> {
  const result = await pool.query<CloudAccountRow>(
    `INSERT INTO cloud_accounts (tenant_id, provider, external_ref, display_name, currency, tags)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     RETURNING ${PROJECTION}`,
    [tenantId, input.provider, input.externalRef, input.displayName, input.currency, input.tags],
  );
  return freezeRow(requiredRow(result.rows[0]));
}

async function patch(
  client: PoolClient,
  input: {
    tenantId: string;
    accountId: string;
    expectedUpdatedAt: string;
    changes: CloudAccountPatchChanges;
  },
): Promise<CloudAccountPatchResult> {
  const current = await lockAccount(client, input.tenantId, input.accountId);
  if (!current) return { kind: "not_found" };
  if (current.updatedAt !== input.expectedUpdatedAt) return { kind: "version_conflict" };
  return { kind: "updated", account: await updateAccount(client, input) };
}

async function deactivate(
  client: PoolClient,
  input: { tenantId: string; accountId: string },
): Promise<CloudAccountDeactivateResult> {
  const current = await lockAccount(client, input.tenantId, input.accountId);
  if (!current) return { kind: "not_found" };
  if (!current.isActive) return { kind: "updated", account: current };
  const result = await client.query<CloudAccountRow>(
    `UPDATE cloud_accounts SET is_active = false
     WHERE tenant_id = $1 AND id = $2
     RETURNING ${PROJECTION}`,
    [input.tenantId, input.accountId],
  );
  return { kind: "updated", account: freezeRow(requiredRow(result.rows[0])) };
}

async function lockAccount(
  client: PoolClient,
  tenantId: string,
  accountId: string,
): Promise<CloudAccountRecord | null> {
  const result = await client.query<CloudAccountRow>(
    `SELECT ${PROJECTION}
     FROM cloud_accounts
     WHERE tenant_id = $1 AND id = $2
     FOR UPDATE`,
    [tenantId, accountId],
  );
  return result.rows[0] ? freezeRow(result.rows[0]) : null;
}

async function updateAccount(
  client: PoolClient,
  input: {
    tenantId: string;
    accountId: string;
    changes: CloudAccountPatchChanges;
  },
): Promise<CloudAccountRecord> {
  const fragments: string[] = [];
  const values: unknown[] = [input.tenantId, input.accountId];
  addUpdate(fragments, values, "external_ref", input.changes.externalRef);
  addUpdate(fragments, values, "display_name", input.changes.displayName);
  addUpdate(fragments, values, "currency", input.changes.currency);
  addUpdate(fragments, values, "tags", input.changes.tags);
  const result = await client.query<CloudAccountRow>(
    `UPDATE cloud_accounts SET ${fragments.join(", ")}
     WHERE tenant_id = $1 AND id = $2
     RETURNING ${PROJECTION}`,
    values,
  );
  return freezeRow(requiredRow(result.rows[0]));
}

function addUpdate(
  fragments: string[],
  values: unknown[],
  column: "external_ref" | "display_name" | "currency" | "tags",
  value: unknown,
): void {
  if (value === undefined) return;
  values.push(column === "tags" ? JSON.stringify(value) : value);
  fragments.push(`${column} = $${values.length}${column === "tags" ? "::jsonb" : ""}`);
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

function requiredRow(row: CloudAccountRow | undefined): CloudAccountRow {
  if (!row) throw new Error("Cloud account mutation did not return a row.");
  return row;
}

function freezeRow(row: CloudAccountRow): CloudAccountRecord {
  return Object.freeze({
    id: row.id,
    provider: row.provider,
    externalRef: row.externalRef,
    displayName: row.displayName,
    currency: row.currency,
    tags: Object.freeze({ ...row.tags }),
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
