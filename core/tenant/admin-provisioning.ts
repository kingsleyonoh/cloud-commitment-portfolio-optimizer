import { Client } from "pg";

import { createArgonExecutor, type ArgonExecutorOptions } from "./argon-executor.js";
import { lockInitialization } from "./initialization-lock.js";
import { hashPassword } from "./password-credential.js";
import { readPasswordFile } from "./password-policy.js";
import { normalizeUserEmail, normalizeUserName, parseUserId } from "./users-input.js";

export interface AdminProvisioningInput {
  databaseUrl: string;
  tenantId: string;
  email: string;
  name: string;
  passwordFile: string;
  argon?: ArgonExecutorOptions;
}

export interface AdminProvisioningResult {
  mode: "created" | "exact_provisioned";
}

interface AdminRow {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
}

export class AdminProvisioningError extends Error {
  readonly code = "ADMIN_PROVISIONING_FAILED";

  constructor() {
    super("Administrator credential provisioning failed; no changes were made.");
    this.name = "AdminProvisioningError";
  }
}

export async function provisionFirstAdmin(
  input: AdminProvisioningInput,
): Promise<AdminProvisioningResult> {
  let prepared: { tenantId: string; email: string; name: string; passwordHash: string };
  const executor = createArgonExecutor(input.argon ?? { concurrency: 2, queueLimit: 32 });
  try {
    prepared = {
      tenantId: parseUserId(input.tenantId),
      email: normalizeUserEmail(input.email),
      name: normalizeUserName(input.name),
      passwordHash: await hashPassword(await readPasswordFile(input.passwordFile), executor),
    };
  } catch {
    throw new AdminProvisioningError();
  } finally {
    executor.close();
  }
  return provisionTransaction(input.databaseUrl, prepared);
}

async function provisionTransaction(
  databaseUrl: string,
  input: { tenantId: string; email: string; name: string; passwordHash: string },
): Promise<AdminProvisioningResult> {
  const client = new Client({ connectionString: databaseUrl });
  let open = false;
  try {
    await client.connect();
    await client.query("BEGIN");
    open = true;
    await lockInitialization(client);
    await lockActiveTenant(client, input.tenantId);
    const target = await selectExactTarget(client, input);
    await insertCredentialAndAudit(client, input, target);
    await client.query("COMMIT");
    open = false;
    return { mode: target.mode };
  } catch {
    if (open) await client.query("ROLLBACK").catch(() => undefined);
    throw new AdminProvisioningError();
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function lockActiveTenant(client: Client, tenantId: string): Promise<void> {
  const result = await client.query(
    "SELECT id FROM tenants WHERE id = $1 AND is_active = true FOR UPDATE",
    [tenantId],
  );
  if (result.rowCount !== 1) throw new AdminProvisioningError();
}

async function selectExactTarget(
  client: Client,
  input: { tenantId: string; email: string; name: string },
): Promise<{ userId: string; mode: AdminProvisioningResult["mode"] }> {
  const result = await client.query<AdminRow>(
    `SELECT id, email, name, is_active AS "isActive"
     FROM users WHERE tenant_id = $1 AND role = 'tenant_admin' FOR UPDATE`,
    [input.tenantId],
  );
  if (result.rowCount === 0) {
    const created = await client.query<{ id: string }>(
      `INSERT INTO users (tenant_id, email, name, role, is_active)
       VALUES ($1, $2, $3, 'tenant_admin', true) RETURNING id`,
      [input.tenantId, input.email, input.name],
    );
    return { userId: created.rows[0]!.id, mode: "created" };
  }
  const admin = result.rows[0];
  if (
    result.rowCount !== 1 ||
    !admin?.isActive ||
    admin.email !== input.email ||
    admin.name !== input.name
  ) {
    throw new AdminProvisioningError();
  }
  await requireCredentialFree(client, input.tenantId, admin.id);
  return { userId: admin.id, mode: "exact_provisioned" };
}

async function requireCredentialFree(
  client: Client,
  tenantId: string,
  userId: string,
): Promise<void> {
  const result = await client.query(
    `SELECT user_id FROM user_auth_credentials
     WHERE tenant_id = $1 AND user_id = $2 FOR UPDATE`,
    [tenantId, userId],
  );
  if (result.rowCount !== 0) throw new AdminProvisioningError();
}

async function insertCredentialAndAudit(
  client: Client,
  input: { tenantId: string; passwordHash: string },
  target: { userId: string; mode: AdminProvisioningResult["mode"] },
): Promise<void> {
  await client.query(
    `INSERT INTO user_auth_credentials (tenant_id, user_id, password_hash)
     VALUES ($1, $2, $3)`,
    [input.tenantId, target.userId, input.passwordHash],
  );
  const audit = await client.query(
    `INSERT INTO audit_log
      (tenant_id, actor_type, action, entity_type, entity_id, new_values)
     VALUES ($1, 'system', 'user.admin_bootstrapped', 'user', $2,
       jsonb_build_object('result', 'succeeded', 'mode', $3::text))`,
    [input.tenantId, target.userId, target.mode],
  );
  if (audit.rowCount !== 1) throw new AdminProvisioningError();
}
