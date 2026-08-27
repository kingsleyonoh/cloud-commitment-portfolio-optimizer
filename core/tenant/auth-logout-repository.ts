import type { Pool, PoolClient, QueryResultRow } from "pg";

import { AppError } from "../shared/errors.js";
import { authError } from "./auth-errors.js";
import { insertLogoutAudit } from "./auth-session-audit.js";
import { safeDigestEqual } from "./auth-session-crypto.js";
import type { LogoutTransactionResult } from "./auth-session-types.js";

export interface LogoutInput {
  familyId: string;
  presentedDigest: Buffer;
  presentedCsrfDigest: Buffer;
  requestId: string;
}

interface LogoutRow extends QueryResultRow {
  tenantId: string;
  userId: string;
  csrfDigest: Buffer;
  revoked: boolean;
}

export interface AuthLogoutRepository {
  findFamilyId(tokenDigest: Buffer): Promise<string | null>;
  logout(input: LogoutInput): Promise<LogoutTransactionResult>;
}

export function createAuthLogoutRepository(pool: Pool): AuthLogoutRepository {
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
    async logout(input) {
      const client = await connect(pool);
      return logoutTransaction(client, input);
    },
  };
}

async function logoutTransaction(
  client: PoolClient,
  input: LogoutInput,
): Promise<LogoutTransactionResult> {
  let open = false;
  try {
    await client.query("BEGIN");
    open = true;
    const family = await client.query(
      "SELECT id FROM auth_refresh_families WHERE id=$1 FOR UPDATE",
      [input.familyId],
    );
    if (family.rowCount !== 1) {
      await client.query("ROLLBACK");
      open = false;
      return { kind: "complete" };
    }
    const row = await readToken(client, input.familyId, input.presentedDigest);
    if (!row) {
      await client.query("ROLLBACK");
      open = false;
      return { kind: "complete" };
    }
    if (!safeDigestEqual(row.csrfDigest, input.presentedCsrfDigest)) {
      await client.query("ROLLBACK");
      open = false;
      return { kind: "csrf_invalid" };
    }
    if (!row.revoked) await revokeAndAudit(client, input, row);
    await client.query("COMMIT");
    open = false;
    return { kind: "complete" };
  } catch (error) {
    if (open) await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof AppError) throw error;
    throw unavailable();
  } finally {
    client.release();
  }
}

async function readToken(
  client: PoolClient,
  familyId: string,
  digest: Buffer,
): Promise<LogoutRow | null> {
  const result = await client.query<LogoutRow>(
    `SELECT f.tenant_id AS "tenantId",f.user_id AS "userId",r.csrf_digest AS "csrfDigest",
      (f.revoked_at IS NOT NULL) AS revoked
     FROM auth_refresh_families f JOIN auth_refresh_tokens r
       ON r.family_id=f.id AND r.tenant_id=f.tenant_id
     WHERE f.id=$1 AND r.token_digest=$2 LIMIT 2`,
    [familyId, digest],
  );
  return result.rows.length === 1 ? result.rows[0]! : null;
}

async function revokeAndAudit(client: PoolClient, input: LogoutInput, row: LogoutRow) {
  const revoked = await client.query(
    `UPDATE auth_refresh_families SET revoked_at=transaction_timestamp(),revocation_reason='logout'
     WHERE id=$1 AND revoked_at IS NULL`,
    [input.familyId],
  );
  if (revoked.rowCount !== 1) throw unavailable();
  await insertLogoutAudit(client, {
    tenantId: row.tenantId,
    userId: row.userId,
    requestId: input.requestId,
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
