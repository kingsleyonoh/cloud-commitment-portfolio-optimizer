import { Client } from "pg";

import { insertImportTenant } from "./import-batches-schema.js";

export interface PriceVersionInput {
  provider: string;
  instrument: string;
  versionLabel: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  sourceUri: string;
  status: string;
  checksum: string;
}

export interface PriceItemInput {
  provider: string;
  instrument: string;
  sku: string;
  region: string;
  termMonths: string;
  paymentOption: string;
  hourlyRateCents: string;
  upfrontCents: string;
  coverageRules: string;
}

export const validPriceVersion: PriceVersionInput = {
  provider: "aws",
  instrument: "aws_compute_savings_plan",
  versionLabel: "synthetic-2026-01",
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  sourceUri: "prices/synthetic/aws-compute-2026-01.json",
  status: "draft",
  checksum: "a".repeat(64),
};

export const validPriceItem: PriceItemInput = {
  provider: "aws",
  instrument: "aws_compute_savings_plan",
  sku: "synthetic-compute-small",
  region: "test-region-1",
  termMonths: "12",
  paymentOption: "no_upfront",
  hourlyRateCents: "123456789",
  upfrontCents: "0",
  coverageRules: '{"service":"synthetic-compute","eligible":true}',
};

export async function insertPriceTenant(client: Client, label: string): Promise<string> {
  return insertImportTenant(client, label);
}

export async function insertPriceVersion(
  client: Client,
  tenantId: string,
  overrides: Partial<PriceVersionInput> = {},
) {
  const version = { ...validPriceVersion, ...overrides };
  return client.query<{
    id: string;
    status: string;
    checksum: string;
    created_at: Date;
    updated_at: Date;
  }>(
    `INSERT INTO price_table_versions
       (tenant_id, provider, instrument, version_label, effective_from, effective_to,
        source_uri, status, checksum)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, status, checksum, created_at, updated_at`,
    [
      tenantId,
      version.provider,
      version.instrument,
      version.versionLabel,
      version.effectiveFrom,
      version.effectiveTo,
      version.sourceUri,
      version.status,
      version.checksum,
    ],
  );
}

export async function insertPriceItem(
  client: Client,
  tenantId: string,
  versionId: string,
  overrides: Partial<PriceItemInput> = {},
) {
  const item = { ...validPriceItem, ...overrides };
  return client.query<{
    id: string;
    hourly_rate_cents: string;
    upfront_cents: string;
    coverage_rules: object;
  }>(
    `INSERT INTO price_table_items
       (tenant_id, price_table_version_id, provider, instrument, sku, region,
        term_months, payment_option, hourly_rate_cents, upfront_cents, coverage_rules)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
     RETURNING id, hourly_rate_cents, upfront_cents, coverage_rules`,
    [
      tenantId,
      versionId,
      item.provider,
      item.instrument,
      item.sku,
      item.region,
      item.termMonths,
      item.paymentOption,
      item.hourlyRateCents,
      item.upfrontCents,
      item.coverageRules,
    ],
  );
}
