import { Client } from "pg";

export async function insertImportTenant(client: Client, label: string): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO tenants (name, legal_name, full_legal_name, display_name)
     VALUES ($1, $1, $1, $1) RETURNING id`,
    [label],
  );
  return result.rows[0]!.id;
}

export async function insertImportAccount(
  client: Client,
  tenantId: string,
  label: string,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO cloud_accounts
       (tenant_id, provider, external_ref, display_name, currency)
     VALUES ($1, 'aws', $2, $3, 'USD') RETURNING id`,
    [tenantId, label, `Synthetic ${label}`],
  );
  return result.rows[0]!.id;
}

export async function insertImportUser(
  client: Client,
  tenantId: string,
  label: string,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO users (tenant_id, email, name, role)
     VALUES ($1, $2, $3, 'finops_analyst') RETURNING id`,
    [tenantId, `${label}@example.test`, `Synthetic ${label}`],
  );
  return result.rows[0]!.id;
}

export const validImportMetadata = {
  source: "synthetic",
  format: "csv",
  objectUri: "imports/synthetic/usage-2026-01.csv",
  schemaVersion: "synthetic_csv:v1",
} as const;
