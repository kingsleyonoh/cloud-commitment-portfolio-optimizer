import { createHash, randomUUID } from "node:crypto";
import type { Client } from "pg";
import { apiKeyMetadataFixtures } from "../fixtures/api-key-metadata.js";
import { tenantFixtures, type TenantFixture } from "../fixtures/tenants.js";
import { userFixtures } from "../fixtures/users.js";

const tenantInsert = `INSERT INTO tenants
  (id, name, legal_name, full_legal_name, display_name, address, registration,
   contact_email, contact_phone, support_url, finance_owner_email, wordmark,
   default_currency, timezone, risk_budget_cents, is_active)
 VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12, $13, $14, $15, $16)`;
const tenantSelect = `SELECT id, name, legal_name AS "legalName",
  full_legal_name AS "fullLegalName", display_name AS "displayName", address, registration,
  contact_email AS "contactEmail", contact_phone AS "contactPhone",
  support_url AS "supportUrl", finance_owner_email AS "financeOwnerEmail", wordmark,
  default_currency AS "defaultCurrency", timezone,
  risk_budget_cents::integer AS "riskBudgetCents", is_active AS "isActive"
 FROM tenants WHERE id = $1`;

export interface FixtureBundle {
  readonly tenant: readonly unknown[];
  readonly users: readonly unknown[];
  readonly metadata: readonly unknown[];
}

function tenantParameters(tenant: TenantFixture): unknown[] {
  return [
    tenant.id,
    tenant.name,
    tenant.legalName,
    tenant.fullLegalName,
    tenant.displayName,
    JSON.stringify(tenant.address),
    JSON.stringify(tenant.registration),
    tenant.contactEmail,
    tenant.contactPhone,
    tenant.supportUrl,
    tenant.financeOwnerEmail,
    tenant.wordmark,
    tenant.defaultCurrency,
    tenant.timezone,
    tenant.riskBudgetCents,
    tenant.isActive,
  ];
}

async function insertTenant(client: Client, tenant: TenantFixture): Promise<void> {
  await client.query(tenantInsert, tenantParameters(tenant));
}

async function insertUsers(client: Client): Promise<void> {
  for (const user of userFixtures) {
    await client.query(
      `INSERT INTO users (id, tenant_id, email, name, role, is_active)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [user.id, user.tenantId, user.email, user.name, user.role, user.isActive],
    );
  }
}

async function insertMetadata(client: Client): Promise<void> {
  for (const metadata of apiKeyMetadataFixtures) {
    const syntheticStoredValue = createHash("sha256").update(randomUUID()).digest("hex");
    await client.query(
      `INSERT INTO api_keys (id, tenant_id, key_hash, note, created_at, revoked_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        metadata.id,
        metadata.tenantId,
        syntheticStoredValue,
        metadata.note,
        metadata.createdAt,
        metadata.revokedAt,
      ],
    );
  }
}

export async function insertIdentityFixtures(client: Client): Promise<void> {
  for (const tenant of Object.values(tenantFixtures)) await insertTenant(client, tenant);
  await insertUsers(client);
  await insertMetadata(client);
}

export async function readFixtureBundle(client: Client, tenantId: string): Promise<FixtureBundle> {
  const tenant = await client.query(tenantSelect, [tenantId]);
  const users = await client.query(
    `SELECT id, tenant_id AS "tenantId", email, name, role, is_active AS "isActive"
     FROM users WHERE tenant_id = $1 ORDER BY id`,
    [tenantId],
  );
  const metadata = await client.query(
    `SELECT id, tenant_id AS "tenantId", note,
            to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",
            CASE WHEN revoked_at IS NULL THEN NULL ELSE
              to_char(revoked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS "revokedAt"
     FROM api_keys WHERE tenant_id = $1 ORDER BY id`,
    [tenantId],
  );
  return { tenant: tenant.rows, users: users.rows, metadata: metadata.rows };
}
