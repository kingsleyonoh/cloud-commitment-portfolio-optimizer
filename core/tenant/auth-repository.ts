import type { Pool, QueryResultRow } from "pg";

import type { UserRole } from "./request-context.js";

export interface ApiKeyIdentity {
  apiKeyId: string;
  tenantId: string;
  tenantActive: boolean;
}

export interface UserIdentity {
  actorUserId: string;
  tenantId: string;
  role: UserRole;
  userActive: boolean;
  tenantActive: boolean;
}

export interface AuthRepository {
  findApiKeyIdentity(keyHash: string): Promise<ApiKeyIdentity | null>;
  findUserIdentity(input: {
    userId: string;
    tenantId: string;
    role: UserRole;
  }): Promise<UserIdentity | null>;
  findCookieUserIdentity?(input: {
    userId: string;
    tenantId: string;
    role: UserRole;
    familyId: string;
  }): Promise<UserIdentity | null>;
}

interface ApiKeyRow extends QueryResultRow, ApiKeyIdentity {}
interface UserRow extends QueryResultRow, UserIdentity {}
type QueryPool = Pick<Pool, "query">;

export function createAuthRepository(pool: QueryPool): AuthRepository {
  return {
    findApiKeyIdentity: (keyHash) => findApiKeyIdentity(pool, keyHash),
    findUserIdentity: (input) => findUserIdentity(pool, input),
    findCookieUserIdentity: (input) => findCookieUserIdentity(pool, input),
  };
}

async function findApiKeyIdentity(
  pool: QueryPool,
  keyHash: string,
): Promise<ApiKeyIdentity | null> {
  const result = await pool.query<ApiKeyRow>(
    `SELECT k.id AS "apiKeyId", t.id AS "tenantId", t.is_active AS "tenantActive"
     FROM api_keys AS k JOIN tenants AS t ON t.id = k.tenant_id
     WHERE k.key_hash = $1 AND k.revoked_at IS NULL LIMIT 2`,
    [keyHash],
  );
  return exactRow(result.rows);
}

async function findUserIdentity(
  pool: QueryPool,
  input: { userId: string; tenantId: string; role: UserRole },
): Promise<UserIdentity | null> {
  const result = await pool.query<UserRow>(
    `SELECT u.id AS "actorUserId", t.id AS "tenantId", u.role,
            u.is_active AS "userActive", t.is_active AS "tenantActive"
     FROM users AS u JOIN tenants AS t ON t.id = u.tenant_id
     WHERE u.id = $1 AND u.tenant_id = $2 AND t.id = $2 AND u.role = $3 LIMIT 2`,
    [input.userId, input.tenantId, input.role],
  );
  return exactRow(result.rows);
}

async function findCookieUserIdentity(
  pool: QueryPool,
  input: { userId: string; tenantId: string; role: UserRole; familyId: string },
): Promise<UserIdentity | null> {
  const result = await pool.query<UserRow>(
    `SELECT u.id AS "actorUserId", t.id AS "tenantId", u.role,
            u.is_active AS "userActive", t.is_active AS "tenantActive"
     FROM users AS u JOIN tenants AS t ON t.id = u.tenant_id
     JOIN auth_refresh_families AS f
       ON f.id = $4 AND f.tenant_id = u.tenant_id AND f.user_id = u.id
     WHERE u.id = $1 AND u.tenant_id = $2 AND t.id = $2 AND u.role = $3
       AND f.revoked_at IS NULL AND f.absolute_expires_at > transaction_timestamp()
     LIMIT 2`,
    [input.userId, input.tenantId, input.role, input.familyId],
  );
  return exactRow(result.rows);
}

function exactRow<T extends ApiKeyIdentity | UserIdentity>(rows: readonly T[]): T | null {
  return rows.length === 1 ? (Object.freeze({ ...rows[0]! }) as unknown as T) : null;
}
