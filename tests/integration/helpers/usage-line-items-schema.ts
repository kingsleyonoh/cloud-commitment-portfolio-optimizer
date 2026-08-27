import { Client } from "pg";

import { insertImportTenant, validImportMetadata } from "./import-batches-schema.js";

export interface UsageOwners {
  tenantId: string;
  accountId: string;
  batchId: string;
}

interface UsageItemInput {
  provider: string;
  serviceCode: string;
  sku: string;
  region: string;
  usageStart: string;
  usageEnd: string;
  usageQuantity: string;
  usageUnit: string;
  onDemandCostCents: string;
  realizedCostCents: string;
  commitmentAppliedCents: string;
  tags: string;
}

export const validUsageItem: UsageItemInput = {
  provider: "aws",
  serviceCode: "AmazonEC2",
  sku: "m7g.large",
  region: "us-east-1",
  usageStart: "2026-01-01T00:00:00Z",
  usageEnd: "2026-01-01T01:00:00Z",
  usageQuantity: "1.25000000",
  usageUnit: "Hrs",
  onDemandCostCents: "24",
  realizedCostCents: "18",
  commitmentAppliedCents: "12",
  tags: '{"environment":"synthetic"}',
};

export async function insertUsageOwners(
  client: Client,
  label: string,
  provider = "aws",
  batchOwnsAccount = true,
): Promise<UsageOwners> {
  const tenantId = await insertImportTenant(client, `${label} tenant`);
  const account = await client.query<{ id: string }>(
    `INSERT INTO cloud_accounts
       (tenant_id, provider, external_ref, display_name, currency)
     VALUES ($1, $2, $3, $4, 'USD') RETURNING id`,
    [tenantId, provider, `${label}-account`, `${label} account`],
  );
  const accountId = account.rows[0]!.id;
  const batch = await client.query<{ id: string }>(
    `INSERT INTO import_batches
       (tenant_id, cloud_account_id, source, format, object_uri, schema_version)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      tenantId,
      batchOwnsAccount ? accountId : null,
      validImportMetadata.source,
      validImportMetadata.format,
      validImportMetadata.objectUri,
      validImportMetadata.schemaVersion,
    ],
  );
  return { tenantId, accountId, batchId: batch.rows[0]!.id };
}

export async function insertUsageItem(
  client: Client,
  owners: UsageOwners,
  overrides: Partial<UsageItemInput> = {},
) {
  const item = { ...validUsageItem, ...overrides };
  return client.query<{
    id: string;
    usage_quantity: string;
    on_demand_cost_cents: string;
    realized_cost_cents: string;
    commitment_applied_cents: string;
    tags: object;
  }>(
    `INSERT INTO usage_line_items
       (tenant_id, import_batch_id, cloud_account_id, provider, service_code, sku,
        region, usage_start, usage_end, usage_quantity, usage_unit,
        on_demand_cost_cents, realized_cost_cents, commitment_applied_cents, tags)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb)
     RETURNING id, usage_quantity, on_demand_cost_cents, realized_cost_cents,
               commitment_applied_cents, tags`,
    [
      owners.tenantId,
      owners.batchId,
      owners.accountId,
      item.provider,
      item.serviceCode,
      item.sku,
      item.region,
      item.usageStart,
      item.usageEnd,
      item.usageQuantity,
      item.usageUnit,
      item.onDemandCostCents,
      item.realizedCostCents,
      item.commitmentAppliedCents,
      item.tags,
    ],
  );
}
