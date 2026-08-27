import { createHash } from "node:crypto";
import { resolve } from "node:path";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runMigrations } from "../../core/db/migrations.js";
import {
  insertPriceItem,
  insertPriceTenant,
  insertPriceVersion,
} from "./helpers/price-tables-schema.js";
import {
  createIsolatedDatabase,
  dropIsolatedDatabase,
  type IsolatedDatabase,
} from "./helpers/postgres-database.js";

const migrationsDirectory = resolve("db/migrations");
let database: IsolatedDatabase | undefined;
let client: Client;
let tenantId: string;

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_price_tables_validation");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  client = new Client({ connectionString: database.url });
  await client.connect();
  tenantId = await insertPriceTenant(client, "price validation tenant");
});

afterAll(async () => {
  if (client) await client.end();
  await dropIsolatedDatabase(database);
});

async function draftVersion(label: string): Promise<string> {
  const result = await insertPriceVersion(client, tenantId, {
    versionLabel: label,
    checksum: createHash("sha256").update(`synthetic:${label}`).digest("hex"),
  });
  return result.rows[0]!.id;
}

describe("price version canonical identity", () => {
  it.each([
    ["aws", "aws_compute_savings_plan"],
    ["aws", "aws_reserved_instance"],
    ["azure", "azure_savings_plan"],
    ["azure", "azure_reservation"],
    ["gcp", "gcp_committed_use_discount"],
  ])("accepts canonical %s %s", async (provider, instrument) => {
    const suffix = `${provider}-${instrument}`;
    await expect(
      insertPriceVersion(client, tenantId, {
        provider,
        instrument,
        versionLabel: suffix,
        checksum: Buffer.from(suffix).toString("hex").padEnd(64, "0").slice(0, 64),
      }),
    ).resolves.toBeDefined();
  });

  it.each([
    ["AWS", "aws_compute_savings_plan", "price_table_versions_provider_check"],
    ["oracle", "aws_compute_savings_plan", "price_table_versions_provider_check"],
    ["aws", "azure_reservation", "price_table_versions_provider_instrument_check"],
    ["gcp", "aws_reserved_instance", "price_table_versions_provider_instrument_check"],
    ["azure", "future_instrument", "price_table_versions_instrument_check"],
  ])("rejects noncanonical provider/instrument %s/%s", async (provider, instrument, constraint) => {
    await expect(
      insertPriceVersion(client, tenantId, {
        provider,
        instrument,
        versionLabel: `bad-${provider}-${instrument}`,
        checksum: "f".repeat(64),
      }),
    ).rejects.toMatchObject({ constraint });
  });

  it.each([
    ["", "price_table_versions_version_label_canonical_check"],
    [" leading", "price_table_versions_version_label_canonical_check"],
    ["trailing ", "price_table_versions_version_label_canonical_check"],
    ["control\u0001", "price_table_versions_version_label_canonical_check"],
  ])("rejects noncanonical version label %j", async (versionLabel, constraint) => {
    await expect(
      insertPriceVersion(client, tenantId, {
        versionLabel,
        checksum: "e".repeat(64),
      }),
    ).rejects.toMatchObject({ constraint });
  });

  it.each(["A".repeat(64), "a".repeat(63), "a".repeat(65), "z".repeat(64), "sha256:a"])(
    "rejects noncanonical SHA-256 digest %j",
    async (checksum) => {
      await expect(
        insertPriceVersion(client, tenantId, {
          versionLabel: `bad-checksum-${checksum.length}-${checksum.slice(0, 1)}`,
          checksum,
        }),
      ).rejects.toMatchObject({ constraint: "price_table_versions_checksum_shape_check" });
    },
  );

  it("accepts an open effective end and rejects inverted periods", async () => {
    await expect(
      insertPriceVersion(client, tenantId, {
        versionLabel: "open-period",
        checksum: "1".repeat(64),
        effectiveTo: null,
      }),
    ).resolves.toBeDefined();
    await expect(
      insertPriceVersion(client, tenantId, {
        versionLabel: "inverted-period",
        checksum: "2".repeat(64),
        effectiveFrom: "2026-02-01",
        effectiveTo: "2026-01-31",
      }),
    ).rejects.toMatchObject({ constraint: "price_table_versions_effective_period_check" });
  });

  it("rejects noncanonical source references without adding raw payload fields", async () => {
    await expect(
      insertPriceVersion(client, tenantId, {
        versionLabel: "bad-source",
        checksum: "3".repeat(64),
        sourceUri: " raw\u0001uri ",
      }),
    ).rejects.toMatchObject({ constraint: "price_table_versions_source_uri_canonical_check" });
  });
});

describe("price item canonical dimensions and exact economics", () => {
  it("round-trips BIGINT money as decimal strings with object coverage rules", async () => {
    const versionId = await draftVersion("exact-economics");
    const row = (
      await insertPriceItem(client, tenantId, versionId, {
        hourlyRateCents: "9223372036854775807",
        upfrontCents: "9223372036854775807",
        coverageRules: '{"usageTypes":["synthetic"],"minimum":"0.00000001"}',
      })
    ).rows[0]!;
    expect(row).toMatchObject({
      hourly_rate_cents: "9223372036854775807",
      upfront_cents: "9223372036854775807",
      coverage_rules: { usageTypes: ["synthetic"], minimum: "0.00000001" },
    });
    expect(typeof row.hourly_rate_cents).toBe("string");
    expect(typeof row.upfront_cents).toBe("string");
  });

  it.each(["no_upfront", "partial_upfront", "all_upfront", "monthly"])(
    "accepts canonical payment option %s",
    async (paymentOption) => {
      const versionId = await draftVersion(`payment-${paymentOption}`);
      await expect(
        insertPriceItem(client, tenantId, versionId, { paymentOption }),
      ).resolves.toBeDefined();
    },
  );

  it.each([
    ["termMonths", "0", "price_table_items_term_months_positive_check"],
    ["termMonths", "-1", "price_table_items_term_months_positive_check"],
    ["paymentOption", "annual", "price_table_items_payment_option_check"],
    ["hourlyRateCents", "-1", "price_table_items_economics_nonnegative_check"],
    ["upfrontCents", "-1", "price_table_items_economics_nonnegative_check"],
    ["sku", " bad", "price_table_items_sku_canonical_check"],
    ["region", "", "price_table_items_region_canonical_check"],
  ])("rejects out-of-domain %s %s", async (field, value, constraint) => {
    const versionId = await draftVersion(`invalid-${field}-${value}`);
    await expect(
      insertPriceItem(client, tenantId, versionId, { [field]: value }),
    ).rejects.toMatchObject({
      constraint,
    });
  });

  it.each([
    ["hourlyRateCents", "9223372036854775808"],
    ["upfrontCents", "9223372036854775808"],
    ["termMonths", "2147483648"],
  ])("rejects database overflow for %s", async (field, value) => {
    const versionId = await draftVersion(`overflow-${field}`);
    await expect(insertPriceItem(client, tenantId, versionId, { [field]: value })).rejects.toThrow(
      /out of range/iu,
    );
  });

  it.each(["[]", '"rules"', "null"])(
    "rejects non-object coverage rules %s",
    async (coverageRules) => {
      const versionId = await draftVersion(`coverage-${coverageRules.length}-${coverageRules}`);
      await expect(
        insertPriceItem(client, tenantId, versionId, { coverageRules }),
      ).rejects.toMatchObject({ constraint: "price_table_items_coverage_rules_object_check" });
    },
  );

  it("rejects null canonical item dimensions and defaults exact upfront/coverage values", async () => {
    const nullVersion = await draftVersion("null-region");
    await expect(
      client.query(
        `INSERT INTO price_table_items
           (tenant_id, price_table_version_id, provider, instrument, sku, region,
            term_months, payment_option, hourly_rate_cents)
         VALUES ($1, $2, 'aws', 'aws_compute_savings_plan', 'synthetic', NULL, 12,
                 'no_upfront', '1')`,
        [tenantId, nullVersion],
      ),
    ).rejects.toMatchObject({ code: "23502", column: "region" });
    const defaultsVersion = await draftVersion("item-defaults");
    const result = await client.query(
      `INSERT INTO price_table_items
         (tenant_id, price_table_version_id, provider, instrument, sku, region,
          term_months, payment_option, hourly_rate_cents)
       VALUES ($1, $2, 'aws', 'aws_compute_savings_plan', 'synthetic-default',
               'test-region-1', 12, 'no_upfront', '0')
       RETURNING upfront_cents, coverage_rules`,
      [tenantId, defaultsVersion],
    );
    expect(result.rows[0]).toEqual({ upfront_cents: "0", coverage_rules: {} });
  });
});
