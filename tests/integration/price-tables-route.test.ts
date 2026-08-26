import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { dropIsolatedDatabase } from "./helpers/postgres-database.js";
import {
  closePriceTablesHarness,
  createPriceTablesHarness,
  priceTablesAuthorization,
  type PriceTablesHarness,
} from "./helpers/price-tables-app.js";

let harness: PriceTablesHarness;

beforeAll(async () => {
  harness = await createPriceTablesHarness("ccpo_price_tables_route");
});

afterAll(async () => {
  await closePriceTablesHarness(harness);
  await dropIsolatedDatabase(harness?.database);
});

describe("POST /api/price-tables", () => {
  it("creates an AWS Compute Savings Plan draft with frozen items and a deterministic checksum", async () => {
    const response = await postPriceTable(validPriceTableBody("aws-csp-2026-08"));

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      provider: "aws",
      instrument: "aws_compute_savings_plan",
      version_label: "aws-csp-2026-08",
      effective_from: "2026-08-01",
      effective_to: null,
      source_uri: "prices/aws/csp-2026-08.json",
      status: "draft",
      item_count: "2",
    });
    expect(response.json().checksum).toMatch(/^[0-9a-f]{64}$/u);
    expect(response.body).not.toMatch(/tenant_id|raw_file|raw_row|credential|authorization/iu);

    const items = await harness.pool.query(
      `SELECT sku, region, term_months, payment_option, hourly_rate_cents, upfront_cents, coverage_rules
         FROM price_table_items
        WHERE price_table_version_id = $1
        ORDER BY sku`,
      [response.json().id],
    );
    expect(items.rows).toEqual([
      {
        sku: "ComputeSP:c7g.large",
        region: "us-west-2",
        term_months: 12,
        payment_option: "partial_upfront",
        hourly_rate_cents: "8",
        upfront_cents: "1000",
        coverage_rules: { service_code: "AmazonEC2", usage_family: "compute" },
      },
      {
        sku: "ComputeSP:m7g.large",
        region: "us-east-1",
        term_months: 12,
        payment_option: "no_upfront",
        hourly_rate_cents: "10",
        upfront_cents: "0",
        coverage_rules: { service_code: "AmazonEC2", usage_family: "compute" },
      },
    ]);
  });

  it("rejects unsupported provider/instrument, future formats, bad economics, and API keys", async () => {
    for (const payload of [
      { ...validPriceTableBody("bad-provider"), provider: "oracle" },
      { ...validPriceTableBody("bad-instrument"), instrument: "spot_instance" },
      { ...validPriceTableBody("bad-pair"), provider: "azure" },
      { ...validPriceTableBody("bad-term"), items: [{ ...validItem(), term_months: 24 }] },
      {
        ...validPriceTableBody("raw-secret"),
        items: [{ ...validItem(), coverage_rules: { secret: "x" } }],
      },
      { ...validPriceTableBody("unknown"), unknown: true },
    ]) {
      const response = await postPriceTable(payload);
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toEqual({
        code: "VALIDATION_ERROR",
        message: "Request is invalid.",
        details: [],
      });
    }

    const denied = await postPriceTable(validPriceTableBody("api-key-denied"), {
      "x-api-key": harness.analystApiKey,
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("FORBIDDEN");
  });
});

describe("POST /api/price-tables/{id}/activate", () => {
  it("activates a fresh draft and blocks stale drafts without mutating items", async () => {
    const fresh = await postPriceTable(validPriceTableBody("fresh-activate"));
    const activated = await harness.app.inject({
      method: "POST",
      url: `/api/price-tables/${fresh.json().id}/activate`,
      headers: priceTablesAuthorization(harness),
      payload: {},
    });
    expect(activated.statusCode).toBe(200);
    expect(activated.json()).toMatchObject({ id: fresh.json().id, status: "active" });

    const stale = await postPriceTable({
      ...validPriceTableBody("stale-activate"),
      effective_from: "2026-01-01",
      source_uri: "prices/aws/csp-2026-01.json",
    });
    const blocked = await harness.app.inject({
      method: "POST",
      url: `/api/price-tables/${stale.json().id}/activate`,
      headers: priceTablesAuthorization(harness),
      payload: {},
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error).toEqual({
      code: "PRICE_TABLE_STALE",
      message: "Price table is stale.",
      details: [],
    });
    const status = await harness.pool.query<{ status: string; items: string }>(
      `SELECT v.status, count(i.id)::text AS items
         FROM price_table_versions v
         LEFT JOIN price_table_items i ON i.price_table_version_id = v.id
        WHERE v.id = $1
        GROUP BY v.status`,
      [stale.json().id],
    );
    expect(status.rows[0]).toEqual({ status: "blocked", items: "2" });
  });

  it("hides cross-tenant or malformed identifiers without leaking tenant IDs", async () => {
    const foreign = await harness.pool.query<{ id: string }>(
      `INSERT INTO price_table_versions
         (tenant_id, provider, instrument, version_label, effective_from, source_uri, status, checksum)
       VALUES ($1, 'aws', 'aws_compute_savings_plan', 'foreign-price', '2026-08-01',
               'prices/aws/foreign.json', 'draft', repeat('b', 64))
       RETURNING id`,
      [harness.tenantB],
    );
    const response = await harness.app.inject({
      method: "POST",
      url: `/api/price-tables/${foreign.rows[0]!.id}/activate`,
      headers: priceTablesAuthorization(harness),
      payload: {},
    });
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain(harness.tenantB);
  });
});

describe("GET /api/price-tables", () => {
  it("lists only tenant price tables with filters and stable cursor pagination", async () => {
    const created = await postPriceTable(validPriceTableBody("list-visible"));
    await harness.pool.query(
      `INSERT INTO price_table_versions
         (tenant_id, provider, instrument, version_label, effective_from, source_uri, status, checksum)
       VALUES ($1, 'aws', 'aws_compute_savings_plan', 'hidden-price', '2026-08-01',
               'prices/aws/hidden.json', 'draft', repeat('c', 64))`,
      [harness.tenantB],
    );

    const first = await harness.app.inject({
      method: "GET",
      url: "/api/price-tables?provider=aws&instrument=aws_compute_savings_plan&limit=1",
      headers: { "x-api-key": harness.analystApiKey },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().price_tables).toHaveLength(1);
    expect(first.json().price_tables[0]).toMatchObject({ id: created.json().id });
    expect(first.body).not.toContain(harness.tenantB);
    expect(first.body).not.toContain("hidden-price");
    expect(first.json().next_cursor).toEqual(expect.any(String));

    const second = await harness.app.inject({
      method: "GET",
      url: `/api/price-tables?provider=aws&instrument=aws_compute_savings_plan&limit=1&cursor=${first.json().next_cursor}`,
      headers: priceTablesAuthorization(harness, "finops_analyst", "finops_analyst"),
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().price_tables).toHaveLength(1);
    expect(second.json().price_tables[0].id).not.toBe(created.json().id);
  });

  it("rejects tenant-selecting and unsupported filters before repository work", async () => {
    for (const query of [
      `tenant_id=${harness.tenantB}`,
      "limit=0",
      "provider=oracle",
      "instrument=spot_instance",
      "status=queued",
      "unknown=value",
    ]) {
      const response = await harness.app.inject({
        method: "GET",
        url: `/api/price-tables?${query}`,
        headers: priceTablesAuthorization(harness),
      });
      expect(response.statusCode, query).toBe(400);
      expect(response.json().error).toEqual({
        code: "VALIDATION_ERROR",
        message: "Request is invalid.",
        details: [],
      });
    }
  });

  it.each([
    ["aws", "aws_reserved_instance", "AmazonEC2", "us-west-2"],
    ["azure", "azure_savings_plan", "Microsoft.Compute", "eastus"],
    ["azure", "azure_reservation", "Microsoft.Compute", "eastus2"],
    ["gcp", "gcp_committed_use_discount", "Compute Engine", "us-central1"],
  ] as const)(
    "creates and lists a %s %s price table",
    async (provider, instrument, serviceCode, region) => {
      const payload = providerPriceTableBody(
        `${instrument}-route-${Date.now()}`,
        provider,
        instrument,
        serviceCode,
        region,
      );
      const created = await postPriceTable(payload);

      expect(created.statusCode).toBe(201);
      expect(created.json()).toMatchObject({
        provider,
        instrument,
        status: "draft",
        item_count: "1",
      });

      const listed = await harness.app.inject({
        method: "GET",
        url: `/api/price-tables?provider=${provider}&instrument=${instrument}&limit=10`,
        headers: { "x-api-key": harness.analystApiKey },
      });
      expect(listed.statusCode).toBe(200);
      expect(listed.json().price_tables).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: created.json().id })]),
      );
    },
  );
});

function validPriceTableBody(versionLabel: string): Record<string, unknown> {
  return {
    provider: "aws",
    instrument: "aws_compute_savings_plan",
    version_label: versionLabel,
    effective_from: "2026-08-01",
    effective_to: null,
    source_uri: "prices/aws/csp-2026-08.json",
    items: [
      validItem(),
      {
        ...validItem(),
        sku: "ComputeSP:c7g.large",
        region: "us-west-2",
        payment_option: "partial_upfront",
        hourly_rate_cents: "8",
        upfront_cents: "1000",
      },
    ],
  };
}

function validItem(): Record<string, unknown> {
  return {
    sku: "ComputeSP:m7g.large",
    region: "us-east-1",
    term_months: 12,
    payment_option: "no_upfront",
    hourly_rate_cents: "10",
    upfront_cents: "0",
    coverage_rules: { service_code: "AmazonEC2", usage_family: "compute" },
  };
}

function providerPriceTableBody(
  versionLabel: string,
  provider: string,
  instrument: string,
  serviceCode: string,
  region: string,
): Record<string, unknown> {
  return {
    provider,
    instrument,
    version_label: versionLabel,
    effective_from: "2026-08-01",
    effective_to: null,
    source_uri: `prices/${provider}/${instrument}.json`,
    items: [
      {
        sku: `${instrument}:standard`,
        region,
        term_months: 12,
        payment_option: "monthly",
        hourly_rate_cents: "10",
        upfront_cents: "0",
        coverage_rules: { service_code: serviceCode, usage_family: "compute" },
      },
    ],
  };
}

async function postPriceTable(
  payload: Record<string, unknown>,
  headers = priceTablesAuthorization(harness),
): Promise<Awaited<ReturnType<PriceTablesHarness["app"]["inject"]>>> {
  return await harness.app.inject({
    method: "POST",
    url: "/api/price-tables",
    headers: { "content-type": "application/json", ...headers },
    payload,
  });
}
