import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeImportsHarness,
  createImportsHarness,
  importsAuthorization,
  type ImportsHarness,
} from "./helpers/imports-app.js";
import { dropIsolatedDatabase } from "./helpers/postgres-database.js";

let harness: ImportsHarness;

beforeAll(async () => {
  harness = await createImportsHarness("ccpo_imports_ui");
});

afterAll(async () => {
  await closeImportsHarness(harness);
  await dropIsolatedDatabase(harness?.database);
});

describe("/imports UI", () => {
  it("renders tenant import status, quarantine details, and parser warnings without raw object leakage", async () => {
    await harness.pool.query("DELETE FROM usage_line_items");
    await harness.pool.query("DELETE FROM import_batches");
    await seedImportBatch({
      tenantId: harness.tenantA,
      accountId: harness.accountA,
      source: "synthetic",
      status: "completed",
      objectUri: "imports/synthetic/list-warning.csv",
      schemaVersion: "synthetic_csv:v1",
      lineCount: 1,
      parserWarnings: [{ code: "UNKNOWN_OPTIONAL_FIELD", field: "note" }],
    });
    await seedImportBatch({
      tenantId: harness.tenantA,
      accountId: harness.accountA,
      source: "aws_cur",
      status: "quarantined",
      objectUri: "imports/aws/raw-quarantine.csv",
      schemaVersion: "aws_cur_csv:v1",
      lineCount: 1,
      errorDetails: { code: "IMPORT_SCHEMA_DRIFT", missing_field: "lineItem/UnblendedCost" },
    });
    await seedImportBatch({
      tenantId: harness.tenantB,
      accountId: harness.accountB,
      source: "synthetic",
      status: "completed",
      objectUri: "imports/synthetic/hidden-tenant.csv",
      schemaVersion: "synthetic_csv:v1",
      lineCount: 1,
    });

    const response = await harness.app.inject({
      method: "GET",
      url: "/imports",
      headers: { accept: "text/html", ...importsAuthorization(harness) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain(
      "<title>Imports | Cloud Commitment Portfolio Optimizer</title>",
    );
    expect(response.body).toContain("Import health");
    expect(response.body).toContain("completed");
    expect(response.body).toContain("quarantined");
    expect(response.body).toContain("UNKNOWN_OPTIONAL_FIELD");
    expect(response.body).toContain("IMPORT_SCHEMA_DRIFT");
    expect(response.body).toContain("lineItem/UnblendedCost");
    expect(response.body).toContain("Desktop upload path");
    expect(response.body).toContain("Before you upload or share");
    expect(response.body).toContain(
      "Do not upload access keys, passwords, tokens, or other credentials.",
    );
    expect(response.body).toContain("redact them before sharing with support");
    expect(response.body).toContain('data-privacy-consent="billing-export"');
    expect(response.body).not.toContain("imports/synthetic/list-warning.csv");
    expect(response.body).not.toContain("imports/aws/raw-quarantine.csv");
    expect(response.body).not.toContain("imports/synthetic/hidden-tenant.csv");
    expect(response.body).not.toMatch(
      /<script|raw_row|raw_file|key_hash|api_token|secret_value|BEGIN [A-Z ]+ PRIVATE KEY|Bearer [A-Za-z0-9._-]{20,}/iu,
    );
  });

  it("renders import writer guidance for FinOps analysts", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: "/imports",
      headers: {
        accept: "text/html",
        ...importsAuthorization(harness, "finops_analyst", "finops_analyst"),
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Import writer controls");
    expect(response.body).toContain("Synthetic CSV");
    expect(response.body).toContain("AWS CUR CSV");
  });

  it("requires authentication", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: "/imports",
      headers: { accept: "text/html" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.body).not.toMatch(/(?:object_uri|key_hash|password|token|stack|postgres)/iu);
  });
});

async function seedImportBatch(input: {
  tenantId: string;
  accountId: string;
  source: "synthetic" | "aws_cur";
  status: "completed" | "quarantined";
  objectUri: string;
  schemaVersion: string;
  lineCount: number;
  errorDetails?: Record<string, unknown>;
  parserWarnings?: readonly Record<string, unknown>[];
}): Promise<string> {
  const result = await harness.pool.query<{ id: string }>(
    `INSERT INTO import_batches
       (tenant_id, cloud_account_id, source, format, status, object_uri, schema_version,
        line_count, error_details, parser_warnings)
     VALUES ($1, $2, $3, 'csv', $4, $5, $6, $7, $8::jsonb, $9::jsonb)
     RETURNING id`,
    [
      input.tenantId,
      input.accountId,
      input.source,
      input.status,
      input.objectUri,
      input.schemaVersion,
      input.lineCount,
      JSON.stringify(input.errorDetails ?? {}),
      JSON.stringify(input.parserWarnings ?? []),
    ],
  );
  return result.rows[0]!.id;
}
