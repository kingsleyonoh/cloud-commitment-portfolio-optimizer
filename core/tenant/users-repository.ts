import type { Pool, PoolClient, QueryResultRow } from "pg";

import type { UserRole } from "./request-context.js";
import type {
  UserCreateInput,
  UserCursorBoundary,
  UserPatchChanges,
  UserRecord,
} from "./users-types.js";

export type UserPatchResult =
  | { kind: "updated"; user: UserRecord }
  | { kind: "not_found" }
  | { kind: "version_conflict" }
  | { kind: "last_admin" };

export interface UsersRepository {
  list(input: {
    tenantId: string;
    limit: number;
    cursor?: UserCursorBoundary;
  }): Promise<UserRecord[]>;
  create(tenantId: string, input: UserCreateInput): Promise<UserRecord>;
  patch(input: {
    tenantId: string;
    userId: string;
    expectedUpdatedAt: string;
    changes: UserPatchChanges;
  }): Promise<UserPatchResult>;
}

interface UserRow extends QueryResultRow {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

const USER_PROJECTION = `id, email, name, role, is_active AS "isActive",
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt",
  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt"`;

export function createUsersRepository(pool: Pool): UsersRepository {
  return {
    list: (input) => listUsers(pool, input),
    create: (tenantId, input) => createUser(pool, tenantId, input),
    patch: (input) =>
      withTenantTransaction(pool, input.tenantId, (client) => patchLocked(client, input)),
  };
}

async function listUsers(
  pool: Pool,
  input: { tenantId: string; limit: number; cursor?: UserCursorBoundary },
): Promise<UserRecord[]> {
  const cursor = input.cursor;
  const result = await pool.query<UserRow>(
    `SELECT ${USER_PROJECTION}
     FROM users
     WHERE tenant_id = $1
       AND ($2::timestamptz IS NULL OR (created_at, id) < ($2::timestamptz, $3::uuid))
     ORDER BY created_at DESC, id DESC
     LIMIT $4`,
    [input.tenantId, cursor?.createdAt ?? null, cursor?.id ?? null, input.limit + 1],
  );
  return result.rows.map(freezeRow);
}

async function createUser(
  pool: Pool,
  tenantId: string,
  input: UserCreateInput,
): Promise<UserRecord> {
  return withTenantTransaction(pool, tenantId, async (client) => {
    const result = await client.query<UserRow>(
      `INSERT INTO users (tenant_id, email, name, role, is_active)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${USER_PROJECTION}`,
      [tenantId, input.email, input.name, input.role, input.isActive],
    );
    return freezeRow(requiredRow(result.rows[0]));
  });
}

async function patchLocked(
  client: PoolClient,
  input: {
    tenantId: string;
    userId: string;
    expectedUpdatedAt: string;
    changes: UserPatchChanges;
  },
): Promise<UserPatchResult> {
  const current = await lockUser(client, input.tenantId, input.userId);
  if (!current) return { kind: "not_found" };
  if (current.updatedAt !== input.expectedUpdatedAt) return { kind: "version_conflict" };
  if (isAdminRemoval(current, input.changes)) {
    const count = await activeAdminCount(client, input.tenantId);
    if (count <= 1) return { kind: "last_admin" };
  }
  const revocationReason = familyRevocationReason(current, input.changes);
  const user = await updateUser(client, input.tenantId, input.userId, input.changes);
  if (revocationReason) {
    await revokeUserFamilies(client, input.tenantId, input.userId, revocationReason);
  }
  return { kind: "updated", user };
}

async function lockUser(
  client: PoolClient,
  tenantId: string,
  userId: string,
): Promise<UserRecord | null> {
  const result = await client.query<UserRow>(
    `SELECT ${USER_PROJECTION}
     FROM users
     WHERE tenant_id = $1 AND id = $2
     FOR UPDATE`,
    [tenantId, userId],
  );
  return result.rows[0] ? freezeRow(result.rows[0]) : null;
}

function isAdminRemoval(current: UserRecord, changes: UserPatchChanges): boolean {
  if (current.role !== "tenant_admin" || !current.isActive) return false;
  const nextRole = changes.role ?? current.role;
  const nextActive = changes.isActive ?? current.isActive;
  return nextRole !== "tenant_admin" || !nextActive;
}

function familyRevocationReason(
  current: UserRecord,
  changes: UserPatchChanges,
): "role_changed" | "user_inactive" | null {
  const nextActive = changes.isActive ?? current.isActive;
  if (current.isActive && !nextActive) return "user_inactive";
  const nextRole = changes.role ?? current.role;
  return nextRole !== current.role ? "role_changed" : null;
}

async function revokeUserFamilies(
  client: PoolClient,
  tenantId: string,
  userId: string,
  reason: "role_changed" | "user_inactive",
): Promise<void> {
  await client.query(
    `UPDATE auth_refresh_families
     SET revoked_at = transaction_timestamp(), revocation_reason = $3
     WHERE tenant_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [tenantId, userId, reason],
  );
}

async function activeAdminCount(client: PoolClient, tenantId: string): Promise<number> {
  const result = await client.query<{ count: number }>(
    `SELECT count(*)::int AS count
     FROM users
     WHERE tenant_id = $1 AND role = 'tenant_admin' AND is_active = true`,
    [tenantId],
  );
  const count = result.rows[0]?.count;
  if (!Number.isSafeInteger(count) || count! < 0) throw new Error("Invalid active admin count.");
  return count!;
}

async function updateUser(
  client: PoolClient,
  tenantId: string,
  userId: string,
  changes: UserPatchChanges,
): Promise<UserRecord> {
  const fragments: string[] = [];
  const values: unknown[] = [tenantId, userId];
  addUpdate(fragments, values, "email", changes.email);
  addUpdate(fragments, values, "name", changes.name);
  addUpdate(fragments, values, "role", changes.role);
  addUpdate(fragments, values, "is_active", changes.isActive);
  if (fragments.length === 0) throw new Error("A user update requires a field.");
  const result = await client.query<UserRow>(
    `UPDATE users SET ${fragments.join(", ")}
     WHERE tenant_id = $1 AND id = $2
     RETURNING ${USER_PROJECTION}`,
    values,
  );
  return freezeRow(requiredRow(result.rows[0]));
}

function addUpdate(
  fragments: string[],
  values: unknown[],
  column: "email" | "name" | "role" | "is_active",
  value: unknown,
): void {
  if (value === undefined) return;
  values.push(value);
  fragments.push(`${column} = $${values.length}`);
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

function requiredRow(row: UserRow | undefined): UserRow {
  if (!row) throw new Error("User mutation did not return a row.");
  return row;
}

function freezeRow(row: UserRow): UserRecord {
  return Object.freeze({
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
