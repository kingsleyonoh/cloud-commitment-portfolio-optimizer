import { randomBytes, randomUUID } from "node:crypto";
import type { Client } from "pg";

export async function insertRefreshTenant(client: Client, label: string): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO tenants (name, legal_name, full_legal_name, display_name)
     VALUES ($1, $1, $1, $1) RETURNING id`,
    [label],
  );
  return result.rows[0]!.id;
}

export async function insertRefreshUser(
  client: Client,
  tenantId: string,
  label: string,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO users (tenant_id, email, name, role)
     VALUES ($1, $2, $3, 'tenant_admin') RETURNING id`,
    [tenantId, `refresh-${randomUUID()}@example.invalid`, label],
  );
  return result.rows[0]!.id;
}

export async function insertRefreshFamily(
  client: Client,
  tenantId: string,
  userId: string,
  absoluteExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO auth_refresh_families (tenant_id, user_id, absolute_expires_at)
     VALUES ($1, $2, $3) RETURNING id`,
    [tenantId, userId, absoluteExpiry],
  );
  return result.rows[0]!.id;
}

export async function insertRefreshToken(
  client: Client,
  tenantId: string,
  familyId: string,
  parentTokenId: string | null = null,
  idleExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO auth_refresh_tokens
       (tenant_id, family_id, parent_token_id, token_digest, csrf_digest, idle_expires_at)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [tenantId, familyId, parentTokenId, randomBytes(32), randomBytes(32), idleExpiry],
  );
  return result.rows[0]!.id;
}

export function runtimeDigests(): [Buffer, Buffer] {
  return [randomBytes(32), randomBytes(32)];
}
