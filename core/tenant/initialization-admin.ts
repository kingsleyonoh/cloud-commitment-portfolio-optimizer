import type { Client } from "pg";

import { isAllowedPasswordPhc } from "./password-credential.js";

export interface PreparedFirstRunAdmin {
  email: string;
  name: string;
  passwordHash: string;
}

interface ExistingAdminRow {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
}

export async function insertFreshAdmin(
  client: Client,
  tenantId: string,
  admin: PreparedFirstRunAdmin | null,
): Promise<string | null> {
  if (!admin) return null;
  const user = await client.query<{ id: string }>(
    `INSERT INTO users (tenant_id, email, name, role)
     VALUES ($1, $2, $3, 'tenant_admin') RETURNING id`,
    [tenantId, admin.email, admin.name],
  );
  const userId = user.rows[0]?.id;
  if (!userId) throw new Error("Fresh admin insert returned no row.");
  await client.query(
    `INSERT INTO user_auth_credentials (tenant_id, user_id, password_hash)
     VALUES ($1, $2, $3)`,
    [tenantId, userId, admin.passwordHash],
  );
  await insertSetupAdminAudit(client, tenantId, userId);
  return userId;
}

export async function verifyInitializedAdmin(
  client: Client,
  tenantId: string,
  admin: PreparedFirstRunAdmin,
): Promise<string | null> {
  const result = await client.query<ExistingAdminRow>(
    `SELECT id, email, name, is_active AS "isActive"
     FROM users
     WHERE tenant_id = $1 AND role = 'tenant_admin'
     FOR UPDATE`,
    [tenantId],
  );
  const row = result.rows[0];
  if (
    result.rowCount !== 1 ||
    !row ||
    row.email !== admin.email ||
    row.name !== admin.name ||
    !row.isActive
  ) {
    return null;
  }
  const credential = await client.query<{ passwordHash: string }>(
    `SELECT password_hash AS "passwordHash"
     FROM user_auth_credentials
     WHERE tenant_id = $1 AND user_id = $2
     FOR UPDATE`,
    [tenantId, row.id],
  );
  return isAllowedPasswordPhc(credential.rows[0]?.passwordHash) ? row.id : null;
}

async function insertSetupAdminAudit(
  client: Client,
  tenantId: string,
  userId: string,
): Promise<void> {
  const result = await client.query(
    `INSERT INTO audit_log
      (tenant_id, actor_type, action, entity_type, entity_id, new_values)
     VALUES ($1, 'system', 'user.admin_bootstrapped', 'user', $2,
       '{"result":"succeeded","mode":"created"}'::jsonb)`,
    [tenantId, userId],
  );
  if (result.rowCount !== 1) throw new Error("Fresh admin audit insert returned no row.");
}
