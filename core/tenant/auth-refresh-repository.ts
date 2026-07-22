import type { Pool, PoolClient } from "pg";

import { AppError } from "../shared/errors.js";
import { authError } from "./auth-errors.js";
import { insertLoginDeniedAudit, insertRefreshReuseAudit } from "./auth-session-audit.js";
import { rotateCurrent } from "./auth-refresh-rotation.js";
import type { RefreshRotateInput, RefreshRow } from "./auth-refresh-types.js";
import { safeDigestEqual } from "./auth-session-crypto.js";
import type { RefreshTransactionResult } from "./auth-session-types.js";

export type { RefreshRotateInput } from "./auth-refresh-types.js";
export interface AuthRefreshRepository {
  findFamilyId(tokenDigest: Buffer): Promise<string | null>;
  rotate(input: RefreshRotateInput): Promise<RefreshTransactionResult>;
}

export function createAuthRefreshRepository(pool: Pool): AuthRefreshRepository {
  return {
    async findFamilyId(tokenDigest) {
      try {
        const result = await pool.query<{ familyId: string }>(
          `SELECT family_id AS "familyId" FROM auth_refresh_tokens
           WHERE token_digest=$1 LIMIT 2`,
          [tokenDigest],
        );
        return result.rows.length === 1 ? result.rows[0]!.familyId : null;
      } catch {
        throw unavailable();
      }
    },
    async rotate(input) {
      const client = await connect(pool);
      return rotateTransaction(client, input);
    },
  };
}

async function rotateTransaction(
  client: PoolClient,
  input: RefreshRotateInput,
): Promise<RefreshTransactionResult> {
  let open = false;
  try {
    await client.query("BEGIN");
    open = true;
    const result = await evaluateLockedRefresh(client, input);
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

async function evaluateLockedRefresh(
  client: PoolClient,
  input: RefreshRotateInput,
): Promise<RefreshTransactionResult> {
  const family = await client.query("SELECT id FROM auth_refresh_families WHERE id=$1 FOR UPDATE", [
    input.familyId,
  ]);
  if (family.rowCount !== 1) return { kind: "invalid" };
  const row = await readRefresh(client, input.familyId, input.presentedDigest);
  if (!row) return { kind: "invalid" };
  if (!safeDigestEqual(row.csrfDigest, input.presentedCsrfDigest)) {
    return { kind: "csrf_invalid" };
  }
  if (row.revoked) return { kind: "invalid" };
  const inactive = !row.tenantActive ? "tenant_inactive" : !row.userActive ? "user_inactive" : null;
  if (inactive) {
    await revokeInactive(client, row, inactive, input.requestId);
    return { kind: inactive };
  }
  if (row.used) {
    await revokeReuse(client, row, input.requestId);
    return { kind: "invalid" };
  }
  if (!row.idleValid || !row.absoluteValid) return { kind: "invalid" };
  return { kind: "issued", issue: await rotateCurrent(client, input, row) };
}

async function readRefresh(
  client: PoolClient,
  familyId: string,
  digest: Buffer,
): Promise<RefreshRow | null> {
  const result = await client.query<RefreshRow>(
    `SELECT r.id AS "tokenId", f.id AS "familyId", f.tenant_id AS "tenantId", f.user_id AS "userId", u.role,
      u.is_active AS "userActive", t.is_active AS "tenantActive", r.csrf_digest AS "csrfDigest",
      (r.used_at IS NOT NULL) AS used, (r.idle_expires_at>transaction_timestamp()) AS "idleValid",
      (f.absolute_expires_at>transaction_timestamp()) AS "absoluteValid",
      (f.revoked_at IS NOT NULL) AS revoked,
      to_char(f.absolute_expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "absoluteExpiresAt"
     FROM auth_refresh_families f
     JOIN auth_refresh_tokens r ON r.family_id=f.id AND r.tenant_id=f.tenant_id
     JOIN users u ON u.id=f.user_id AND u.tenant_id=f.tenant_id
     JOIN tenants t ON t.id=f.tenant_id
     WHERE f.id=$1 AND r.token_digest=$2 LIMIT 2`,
    [familyId, digest],
  );
  return result.rows.length === 1 ? result.rows[0]! : null;
}

async function revokeReuse(client: PoolClient, row: RefreshRow, requestId: string) {
  const revoked = await client.query(
    `UPDATE auth_refresh_families SET revoked_at=transaction_timestamp(),revocation_reason='reuse_detected'
     WHERE id=$1 AND revoked_at IS NULL`,
    [row.familyId],
  );
  if (revoked.rowCount !== 1) throw unavailable();
  await insertRefreshReuseAudit(client, {
    tenantId: row.tenantId,
    userId: row.userId,
    requestId,
  });
}

async function revokeInactive(
  client: PoolClient,
  row: RefreshRow,
  reason: "user_inactive" | "tenant_inactive",
  requestId: string,
) {
  await client.query(
    `UPDATE auth_refresh_families SET revoked_at=transaction_timestamp(),revocation_reason=$2
     WHERE id=$1 AND revoked_at IS NULL`,
    [row.familyId, reason],
  );
  await insertLoginDeniedAudit(client, {
    tenantId: row.tenantId,
    userId: row.userId,
    reason,
    requestId,
  });
}

async function connect(pool: Pool): Promise<PoolClient> {
  try {
    return await pool.connect();
  } catch {
    throw unavailable();
  }
}
function unavailable() {
  return authError("AUTH_DEPENDENCY_UNAVAILABLE");
}
