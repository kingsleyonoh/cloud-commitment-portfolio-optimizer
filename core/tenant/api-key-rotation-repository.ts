import type { Pool, PoolClient, QueryResultRow } from "pg";

import { AppError } from "../shared/errors.js";
import { insertRotationAudit } from "./rotation-audit-writer.js";
import type { ApiKeyRotationCommitted } from "./api-key-rotation-types.js";

interface RotationRow extends QueryResultRow {
  id: string;
  note: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface ApiKeyRotationRepositoryInput {
  tenantId: string;
  actorUserId: string;
  requestId: string;
  apiKeyId: string;
  note: string | null;
  keyHash: string;
}

export interface ApiKeyRotationRepository {
  rotate(input: ApiKeyRotationRepositoryInput): Promise<ApiKeyRotationCommitted>;
}

const KEY_PROJECTION = `id, note,
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt",
  CASE WHEN revoked_at IS NULL THEN NULL
    ELSE to_char(revoked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  END AS "revokedAt"`;

export function createApiKeyRotationRepository(pool: Pool): ApiKeyRotationRepository {
  return {
    async rotate(input) {
      let client: PoolClient;
      try {
        client = await pool.connect();
      } catch {
        throw unavailable();
      }
      return rotateTransaction(client, input);
    },
  };
}

async function rotateTransaction(
  client: PoolClient,
  input: ApiKeyRotationRepositoryInput,
): Promise<ApiKeyRotationCommitted> {
  let open = false;
  try {
    await client.query("BEGIN");
    open = true;
    const result = await performRotation(client, input);
    await client.query("COMMIT");
    open = false;
    return result;
  } catch (error) {
    if (open) await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof AppError) throw error;
    throw unavailable();
  } finally {
    client.release();
  }
}

async function performRotation(
  client: PoolClient,
  input: ApiKeyRotationRepositoryInput,
): Promise<ApiKeyRotationCommitted> {
  const oldKey = await lockSelectedKey(client, input.tenantId, input.apiKeyId);
  if (!oldKey) throw notFound();
  const timestamp = await transactionTimestamp(client);
  const revoked = await revokeSelectedKey(client, input, timestamp);
  const replacement = await insertReplacement(client, input, timestamp);
  const auditId = await insertRotationAudit(client, {
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    requestId: input.requestId,
    oldKey: { id: oldKey.id, createdAt: oldKey.createdAt },
    revokedAt: timestamp,
    replacement: { id: replacement.id, createdAt: replacement.createdAt },
  });
  return committedResult(revoked, replacement, timestamp, auditId);
}

function committedResult(
  revoked: RotationRow,
  replacement: RotationRow,
  timestamp: string,
  auditId: string,
): ApiKeyRotationCommitted {
  return {
    revokedApiKey: {
      id: revoked.id,
      note: revoked.note,
      created_at: revoked.createdAt,
      revoked_at: timestamp,
    },
    replacementApiKey: {
      id: replacement.id,
      note: replacement.note,
      created_at: replacement.createdAt,
      revoked_at: null,
    },
    auditId,
  };
}

async function lockSelectedKey(
  client: PoolClient,
  tenantId: string,
  apiKeyId: string,
): Promise<RotationRow | null> {
  const result = await client.query<RotationRow>(
    `SELECT ${KEY_PROJECTION} FROM api_keys
     WHERE tenant_id = $1 AND id = $2 AND revoked_at IS NULL
     FOR UPDATE`,
    [tenantId, apiKeyId],
  );
  return result.rows[0] ?? null;
}

async function transactionTimestamp(client: PoolClient): Promise<string> {
  const result = await client.query<{ value: string }>(
    `SELECT to_char(transaction_timestamp() AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS value`,
  );
  const value = result.rows[0]?.value;
  if (!value) throw new Error("Transaction timestamp was unavailable.");
  return value;
}

async function revokeSelectedKey(
  client: PoolClient,
  input: ApiKeyRotationRepositoryInput,
  timestamp: string,
): Promise<RotationRow> {
  const result = await client.query<RotationRow>(
    `UPDATE api_keys SET revoked_at = $3::timestamptz
     WHERE tenant_id = $1 AND id = $2 AND revoked_at IS NULL
     RETURNING ${KEY_PROJECTION}`,
    [input.tenantId, input.apiKeyId, timestamp],
  );
  if (result.rowCount !== 1 || !result.rows[0]) throw notFound();
  return result.rows[0];
}

async function insertReplacement(
  client: PoolClient,
  input: ApiKeyRotationRepositoryInput,
  timestamp: string,
): Promise<RotationRow> {
  const result = await client.query<RotationRow>(
    `INSERT INTO api_keys (tenant_id, key_hash, note, created_at)
     VALUES ($1, $2, $3, $4::timestamptz)
     RETURNING ${KEY_PROJECTION}`,
    [input.tenantId, input.keyHash, input.note, timestamp],
  );
  if (result.rowCount !== 1 || !result.rows[0]) throw new Error("Replacement insert failed.");
  return result.rows[0];
}

function notFound(): AppError {
  return new AppError({
    code: "NOT_FOUND",
    message: "API key was not found.",
    statusCode: 404,
    details: [],
  });
}

function unavailable(): AppError {
  return new AppError({
    code: "API_KEY_ROTATION_UNAVAILABLE",
    message: "API-key rotation is temporarily unavailable.",
    statusCode: 503,
    details: [],
  });
}
