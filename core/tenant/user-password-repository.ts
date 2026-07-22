import type { Pool, PoolClient } from "pg";

import { AppError } from "../shared/errors.js";
import { authError } from "./auth-errors.js";

export interface UserPasswordMutationInput {
  tenantId: string;
  actorUserId: string;
  targetUserId: string;
  requestId: string;
  passwordHash: string;
}

export interface UserPasswordRepository {
  setPassword(input: UserPasswordMutationInput): Promise<void>;
}

export function createUserPasswordRepository(pool: Pool): UserPasswordRepository {
  return {
    async setPassword(input) {
      let client: PoolClient;
      try {
        client = await pool.connect();
      } catch {
        throw unavailable();
      }
      await passwordTransaction(client, input);
    },
  };
}

async function passwordTransaction(
  client: PoolClient,
  input: UserPasswordMutationInput,
): Promise<void> {
  let open = false;
  try {
    await client.query("BEGIN");
    open = true;
    await lockTenant(client, input.tenantId);
    await lockTarget(client, input.tenantId, input.targetUserId);
    const existed = await lockCredential(client, input.tenantId, input.targetUserId);
    const timestamp = await transactionTimestamp(client);
    await writeCredential(client, input, timestamp, existed);
    const sessionsRevoked = await revokeFamilies(client, input, timestamp);
    await insertPasswordAudit(client, input, existed, sessionsRevoked);
    await client.query("COMMIT");
    open = false;
  } catch (error) {
    if (open) await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof AppError) throw error;
    throw unavailable();
  } finally {
    client.release();
  }
}

async function lockTenant(client: PoolClient, tenantId: string): Promise<void> {
  const result = await client.query("SELECT id FROM tenants WHERE id = $1 FOR UPDATE", [tenantId]);
  if (result.rowCount !== 1) throw unavailable();
}

async function lockTarget(
  client: PoolClient,
  tenantId: string,
  targetUserId: string,
): Promise<void> {
  const result = await client.query(
    "SELECT id FROM users WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
    [tenantId, targetUserId],
  );
  if (result.rowCount !== 1) throw notFound();
}

async function lockCredential(
  client: PoolClient,
  tenantId: string,
  targetUserId: string,
): Promise<boolean> {
  const result = await client.query(
    `SELECT user_id FROM user_auth_credentials
     WHERE tenant_id = $1 AND user_id = $2 FOR UPDATE`,
    [tenantId, targetUserId],
  );
  return result.rowCount === 1;
}

async function transactionTimestamp(client: PoolClient): Promise<string> {
  const result = await client.query<{ value: string }>(
    `SELECT to_char(transaction_timestamp() AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS value`,
  );
  const value = result.rows[0]?.value;
  if (!value) throw unavailable();
  return value;
}

async function writeCredential(
  client: PoolClient,
  input: UserPasswordMutationInput,
  timestamp: string,
  existed: boolean,
): Promise<void> {
  const result = existed
    ? await client.query(
        `UPDATE user_auth_credentials
         SET password_hash = $3, password_changed_at = $4::timestamptz
         WHERE tenant_id = $1 AND user_id = $2`,
        [input.tenantId, input.targetUserId, input.passwordHash, timestamp],
      )
    : await client.query(
        `INSERT INTO user_auth_credentials
          (tenant_id, user_id, password_hash, password_changed_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4::timestamptz, $4::timestamptz, $4::timestamptz)`,
        [input.tenantId, input.targetUserId, input.passwordHash, timestamp],
      );
  if (result.rowCount !== 1) throw unavailable();
}

async function revokeFamilies(
  client: PoolClient,
  input: UserPasswordMutationInput,
  timestamp: string,
): Promise<number> {
  const result = await client.query(
    `UPDATE auth_refresh_families
     SET revoked_at = $3::timestamptz, revocation_reason = 'password_reset'
     WHERE tenant_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [input.tenantId, input.targetUserId, timestamp],
  );
  return result.rowCount ?? 0;
}

async function insertPasswordAudit(
  client: PoolClient,
  input: UserPasswordMutationInput,
  existed: boolean,
  sessionsRevoked: number,
): Promise<void> {
  const action = existed ? "user.password.reset" : "user.password.provisioned";
  const result = await client.query(
    `INSERT INTO audit_log
      (tenant_id, actor_user_id, actor_type, action, entity_type, entity_id,
       old_values, new_values, request_id)
     VALUES ($1, $2, 'user', $3, 'user', $4, NULL,
       jsonb_build_object('result', 'succeeded', 'sessions_revoked', $5::int), $6)`,
    [
      input.tenantId,
      input.actorUserId,
      action,
      input.targetUserId,
      sessionsRevoked,
      input.requestId,
    ],
  );
  if (result.rowCount !== 1) throw unavailable();
}

function notFound(): AppError {
  return new AppError({
    code: "NOT_FOUND",
    message: "User was not found.",
    statusCode: 404,
    details: [],
  });
}

function unavailable(): AppError {
  return authError("AUTH_DEPENDENCY_UNAVAILABLE");
}
