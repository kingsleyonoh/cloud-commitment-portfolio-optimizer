import type { PoolClient, QueryResultRow } from "pg";

import { authError } from "./auth-errors.js";
import type { RefreshRotateInput, RefreshRow } from "./auth-refresh-types.js";
import type { SessionIssue } from "./auth-session-types.js";

interface TimeRow extends QueryResultRow {
  issuedAt: number;
  expiresAt: number;
  accessExpiresAt: string;
  idleExpiresAt: string;
}

export async function rotateCurrent(
  client: PoolClient,
  input: RefreshRotateInput,
  row: RefreshRow,
): Promise<SessionIssue> {
  const time = await rotationTime(client, input.accessLifetimeSeconds, row.absoluteExpiresAt);
  await markUsedAndInsertChild(client, input, row, time.idleExpiresAt);
  const accessToken = input.sign({
    userId: row.userId,
    tenantId: row.tenantId,
    role: row.role,
    familyId: input.familyId,
    csrfHash: input.childCsrfDigest.toString("base64url"),
    issuedAt: time.issuedAt,
    expiresAt: time.expiresAt,
  });
  return rotatedIssue(input, row, time, accessToken);
}

async function markUsedAndInsertChild(
  client: PoolClient,
  input: RefreshRotateInput,
  row: RefreshRow,
  idleExpiresAt: string,
): Promise<void> {
  const updated = await client.query(
    "UPDATE auth_refresh_tokens SET used_at=transaction_timestamp() WHERE id=$1 AND used_at IS NULL",
    [row.tokenId],
  );
  if (updated.rowCount !== 1) throw unavailable();
  await client.query(
    `INSERT INTO auth_refresh_tokens
      (id,tenant_id,family_id,parent_token_id,token_digest,csrf_digest,
       idle_expires_at,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz,
       transaction_timestamp(),transaction_timestamp())`,
    [
      input.childId,
      row.tenantId,
      input.familyId,
      row.tokenId,
      input.childTokenDigest,
      input.childCsrfDigest,
      idleExpiresAt,
    ],
  );
}

function rotatedIssue(
  input: RefreshRotateInput,
  row: RefreshRow,
  time: TimeRow,
  accessToken: string,
): SessionIssue {
  return {
    accessToken,
    refreshToken: input.refreshToken,
    csrfToken: input.csrfToken,
    session: {
      user_id: row.userId,
      tenant_id: row.tenantId,
      role: row.role,
      access_expires_at: time.accessExpiresAt,
      refresh_idle_expires_at: time.idleExpiresAt,
      refresh_absolute_expires_at: row.absoluteExpiresAt,
    },
  };
}

async function rotationTime(
  client: PoolClient,
  lifetime: number,
  absolute: string,
): Promise<TimeRow> {
  const result = await client.query<TimeRow>(
    `SELECT floor(extract(epoch FROM transaction_timestamp()))::int AS "issuedAt",
      floor(extract(epoch FROM transaction_timestamp()+$1::int*interval '1 second'))::int AS "expiresAt",
      to_char((transaction_timestamp()+$1::int*interval '1 second') AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "accessExpiresAt",
      to_char(least(transaction_timestamp()+interval '7 days',$2::timestamptz)
        AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "idleExpiresAt"`,
    [lifetime, absolute],
  );
  if (!result.rows[0]) throw unavailable();
  return result.rows[0];
}

function unavailable() {
  return authError("AUTH_DEPENDENCY_UNAVAILABLE");
}
