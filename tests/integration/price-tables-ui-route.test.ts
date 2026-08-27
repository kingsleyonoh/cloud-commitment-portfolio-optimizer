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
  harness = await createPriceTablesHarness("ccpo_price_tables_ui");
});

afterAll(async () => {
  await closePriceTablesHarness(harness);
  await dropIsolatedDatabase(harness?.database);
});

describe("/price-tables UI", () => {
  it("renders tenant price table versions with active, draft, and blocked state without source leakage", async () => {
    await harness.pool.query("DELETE FROM price_table_items");
    await harness.pool.query("DELETE FROM price_table_versions");
    await seedVersion({
      tenantId: harness.tenantA,
      versionLabel: "aws-csp-active-2026-08",
      effectiveFrom: "2026-08-01",
      sourceUri: "prices/aws/csp-active-2026-08.json",
      checksum: "a".repeat(64),
      status: "active",
    });
    await seedVersion({
      tenantId: harness.tenantA,
      versionLabel: "aws-csp-draft-2026-09",
      effectiveFrom: "2026-09-01",
      sourceUri: "prices/aws/csp-draft-2026-09.json",
      checksum: "b".repeat(64),
      status: "draft",
    });
    await seedVersion({
      tenantId: harness.tenantA,
      versionLabel: "aws-csp-blocked-2026-01",
      effectiveFrom: "2026-01-01",
      sourceUri: "prices/aws/csp-blocked-2026-01.json",
      checksum: "c".repeat(64),
      status: "blocked",
    });
    await seedVersion({
      tenantId: harness.tenantB,
      versionLabel: "hidden-price-table",
      effectiveFrom: "2026-08-01",
      sourceUri: "prices/aws/hidden-price-table.json",
      checksum: "d".repeat(64),
      status: "draft",
    });

    const response = await harness.app.inject({
      method: "GET",
      url: "/price-tables",
      headers: { accept: "text/html", ...priceTablesAuthorization(harness) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain(
      "<title>Price tables | Cloud Commitment Portfolio Optimizer</title>",
    );
    expect(response.body).toContain("Price table control");
    expect(response.body).toContain("aws-csp-active-2026-08");
    expect(response.body).toContain("aws-csp-draft-2026-09");
    expect(response.body).toContain("aws-csp-blocked-2026-01");
    expect(response.body).toContain("active");
    expect(response.body).toContain("draft");
    expect(response.body).toContain("blocked");
    expect(response.body).toContain("Upload staging");
    expect(response.body).toContain("Activation gate");
    expect(response.body).not.toContain("prices/aws/csp-active-2026-08.json");
    expect(response.body).not.toContain("hidden-price-table");
    expect(response.body).not.toContain(harness.tenantB);
    expect(response.body).not.toMatch(
      /<script|raw_file|raw_row|key_hash|password|authorization|Bearer/iu,
    );
  });

  it("renders a read-only boundary for FinOps analysts", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: "/price-tables",
      headers: {
        accept: "text/html",
        ...priceTablesAuthorization(harness, "finops_analyst", "finops_analyst"),
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Read-only price access");
    expect(response.body).not.toContain("Tenant Admin price controls");
  });

  it("requires authentication", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: "/price-tables",
      headers: { accept: "text/html" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.body).not.toMatch(/(?:source_uri|key_hash|password|token|stack|postgres)/iu);
  });
});

async function seedVersion(input: {
  tenantId: string;
  versionLabel: string;
  effectiveFrom: string;
  sourceUri: string;
  checksum: string;
  status: "draft" | "active" | "blocked";
}): Promise<string> {
  const result = await harness.pool.query<{ id: string }>(
    `INSERT INTO price_table_versions
       (tenant_id, provider, instrument, version_label, effective_from, source_uri, status, checksum)
     VALUES ($1, 'aws', 'aws_compute_savings_plan', $2, $3, $4, 'draft', $5)
     RETURNING id`,
    [input.tenantId, input.versionLabel, input.effectiveFrom, input.sourceUri, input.checksum],
  );
  const id = result.rows[0]!.id;
  if (input.status !== "draft") {
    await harness.pool.query("UPDATE price_table_versions SET status = $1 WHERE id = $2", [
      input.status,
      id,
    ]);
  }
  return id;
}
