import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { dropIsolatedDatabase } from "./helpers/postgres-database.js";
import {
  closeImportsHarness,
  createImportsHarness,
  importsAuthorization,
  putFixtureObject,
  type ImportsHarness,
} from "./helpers/imports-app.js";

let harness: ImportsHarness;

beforeAll(async () => {
  harness = await createImportsHarness("ccpo_imports_route");
});

afterAll(async () => {
  await closeImportsHarness(harness);
  await dropIsolatedDatabase(harness?.database);
});

describe("POST /api/imports synthetic CSV", () => {
  it("imports synthetic CSV into canonical immutable usage rows with matching control totals", async () => {
    await putFixtureObject(
      harness,
      "imports/synthetic/usage-valid.csv",
      resolve("tests/fixtures/synthetic/usage-valid.csv"),
    );
    const response = await postImport({
      source: "synthetic",
      format: "csv",
      object_uri: "imports/synthetic/usage-valid.csv",
      cloud_account_id: harness.accountA,
      control_totals: [
        {
          provider: "aws",
          service_code: "AmazonEC2",
          region: "us-east-1",
          month: "2026-01",
          line_count: "2",
          usage_quantity: "4.00000000",
          on_demand_cost_cents: "76",
          realized_cost_cents: "58",
          commitment_applied_cents: "32",
        },
        {
          provider: "aws",
          service_code: "AmazonS3",
          region: "us-east-1",
          month: "2026-01",
          line_count: "1",
          usage_quantity: "3.00000000",
          on_demand_cost_cents: "9",
          realized_cost_cents: "7",
          commitment_applied_cents: "0",
        },
      ],
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      cloud_account_id: harness.accountA,
      source: "synthetic",
      format: "csv",
      status: "completed",
      object_uri: "imports/synthetic/usage-valid.csv",
      schema_version: "synthetic_csv:v1",
      line_count: "3",
      error_details: {},
      parser_warnings: [],
    });
    expect(response.body).not.toMatch(/tenant_id|key_hash|plaintext|authorization/iu);
    expect(await usageControlTotals(response.json().id)).toEqual([
      {
        provider: "aws",
        service_code: "AmazonEC2",
        region: "us-east-1",
        month: "2026-01",
        line_count: "2",
        usage_quantity: "4.00000000",
        on_demand_cost_cents: "76",
        realized_cost_cents: "58",
        commitment_applied_cents: "32",
      },
      {
        provider: "aws",
        service_code: "AmazonS3",
        region: "us-east-1",
        month: "2026-01",
        line_count: "1",
        usage_quantity: "3.00000000",
        on_demand_cost_cents: "9",
        realized_cost_cents: "7",
        commitment_applied_cents: "0",
      },
    ]);
    expect(
      harness.logs.find((line) => line.includes("cloud_commitment.import.completed")),
    ).toBeDefined();
  });

  it("quarantines schema drift without partially inserting usage rows", async () => {
    await putFixtureObject(
      harness,
      "imports/synthetic/usage-invalid-missing-cost.csv",
      resolve("tests/fixtures/synthetic/usage-invalid-missing-cost.csv"),
    );
    const response = await postImport({
      source: "synthetic",
      format: "csv",
      object_uri: "imports/synthetic/usage-invalid-missing-cost.csv",
      cloud_account_id: harness.accountA,
      control_totals: [],
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      status: "quarantined",
      line_count: "1",
      parser_warnings: [],
      error_details: { code: "IMPORT_SCHEMA_DRIFT" },
    });
    expect(response.body).not.toMatch(/raw_row|raw_file|raw_bytes|stack/iu);
    const rows = await harness.pool.query<{ count: string }>(
      "SELECT count(*) FROM usage_line_items WHERE import_batch_id = $1",
      [response.json().id],
    );
    expect(rows.rows[0]!.count).toBe("0");
  });

  it("records unknown optional CSV columns as parser warnings while completing import", async () => {
    await putFixtureObject(
      harness,
      "imports/synthetic/usage-warning.csv",
      resolve("tests/fixtures/synthetic/usage-warning.csv"),
    );
    const response = await postImport(
      {
        source: "synthetic",
        format: "csv",
        object_uri: "imports/synthetic/usage-warning.csv",
        cloud_account_id: harness.accountA,
        control_totals: [
          {
            provider: "aws",
            service_code: "AmazonEC2",
            region: "us-west-2",
            month: "2026-02",
            line_count: "1",
            usage_quantity: "1.00000000",
            on_demand_cost_cents: "20",
            realized_cost_cents: "15",
            commitment_applied_cents: "10",
          },
        ],
      },
      { "x-api-key": harness.analystApiKey },
    );

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      status: "completed",
      line_count: "1",
      parser_warnings: [{ code: "UNKNOWN_OPTIONAL_FIELD", field: "note" }],
    });
  });

  it("hides cross-tenant accounts and denies non-writer roles before reading objects", async () => {
    await putFixtureObject(
      harness,
      "imports/synthetic/hidden.csv",
      resolve("tests/fixtures/synthetic/usage-valid.csv"),
    );
    const hidden = await postImport({
      source: "synthetic",
      format: "csv",
      object_uri: "imports/synthetic/hidden.csv",
      cloud_account_id: harness.accountB,
      control_totals: [],
    });
    expect(hidden.statusCode).toBe(404);
    expect(hidden.body).not.toContain(harness.tenantB);

    for (const role of ["finance_approver", "read_only_auditor"] as const) {
      const denied = await postImport(
        {
          source: "synthetic",
          format: "csv",
          object_uri: "imports/synthetic/hidden.csv",
          cloud_account_id: harness.accountA,
          control_totals: [],
        },
        importsAuthorization(harness, role, role),
      );
      expect(denied.statusCode, role).toBe(403);
      expect(denied.json().error.code, role).toBe("FORBIDDEN");
    }
  });

  it("rejects closed-body violations and unsupported source-format pairs before mutation", async () => {
    const before = await importBatchCount();
    for (const payload of [
      {
        source: "synthetic",
        format: "csv",
        object_uri: "x.csv",
        cloud_account_id: harness.accountA,
        tenant_id: harness.tenantB,
      },
      {
        source: "aws_cur",
        format: "csv",
        object_uri: "x.csv",
        cloud_account_id: harness.accountA,
        control_totals: [],
      },
      {
        source: "synthetic",
        format: "json_api_snapshot",
        object_uri: "x.json",
        cloud_account_id: harness.accountA,
        control_totals: [],
      },
      {
        source: "synthetic",
        format: "csv",
        object_uri: "../escape.csv",
        cloud_account_id: harness.accountA,
        control_totals: [],
      },
    ]) {
      const response = await postImport(payload);
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: { code: "VALIDATION_ERROR", message: "Request is invalid.", details: [] },
      });
    }
    expect(await importBatchCount()).toBe(before);
  });
});

describe("GET /api/imports", () => {
  it("lists only tenant imports with filters, warnings, and stable cursor pagination", async () => {
    await putFixtureObject(
      harness,
      "imports/synthetic/list-warning.csv",
      resolve("tests/fixtures/synthetic/usage-warning.csv"),
    );
    const created = await postImport(
      {
        source: "synthetic",
        format: "csv",
        object_uri: "imports/synthetic/list-warning.csv",
        cloud_account_id: harness.accountA,
        control_totals: [
          {
            provider: "aws",
            service_code: "AmazonEC2",
            region: "us-west-2",
            month: "2026-02",
            line_count: "1",
            usage_quantity: "1.00000000",
            on_demand_cost_cents: "20",
            realized_cost_cents: "15",
            commitment_applied_cents: "10",
          },
        ],
      },
      { "x-api-key": harness.analystApiKey },
    );
    await harness.pool.query(
      `INSERT INTO import_batches
         (tenant_id, cloud_account_id, source, format, status, object_uri, schema_version, line_count)
       VALUES ($1, $2, 'synthetic', 'csv', 'completed', 'imports/synthetic/hidden.csv',
               'synthetic_csv:v1', 1)`,
      [harness.tenantB, harness.accountB],
    );

    const first = await harness.app.inject({
      method: "GET",
      url: "/api/imports?source=synthetic&status=completed&limit=1",
      headers: { "x-api-key": harness.analystApiKey },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().imports).toHaveLength(1);
    expect(first.json().imports[0]).toMatchObject({
      id: created.json().id,
      parser_warnings: [{ code: "UNKNOWN_OPTIONAL_FIELD", field: "note" }],
    });
    expect(first.body).not.toContain(harness.tenantB);
    expect(first.body).not.toContain("hidden.csv");
    expect(first.json().next_cursor).toEqual(expect.any(String));

    const second = await harness.app.inject({
      method: "GET",
      url: `/api/imports?source=synthetic&status=completed&limit=1&cursor=${first.json().next_cursor}`,
      headers: importsAuthorization(harness, "finops_analyst", "finops_analyst"),
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().imports).toHaveLength(1);
    expect(second.json().imports[0].id).not.toBe(created.json().id);
  });

  it("rejects tenant-selecting and malformed filters before repository work", async () => {
    for (const query of [
      `tenant_id=${harness.tenantB}`,
      "limit=0",
      "status=queued%00",
      "source=aws_cur",
      "format=json_api_snapshot",
      "unknown=value",
    ]) {
      const response = await harness.app.inject({
        method: "GET",
        url: `/api/imports?${query}`,
        headers: importsAuthorization(harness),
      });
      expect(response.statusCode, query).toBe(400);
      expect(response.json().error).toEqual({
        code: "VALIDATION_ERROR",
        message: "Request is invalid.",
        details: [],
      });
    }
  });
});

describe("GET /api/imports/{id}", () => {
  it("returns import detail with parser warnings and hides cross-tenant IDs", async () => {
    await putFixtureObject(
      harness,
      "imports/synthetic/detail-warning.csv",
      resolve("tests/fixtures/synthetic/usage-warning.csv"),
    );
    const created = await postImport({
      source: "synthetic",
      format: "csv",
      object_uri: "imports/synthetic/detail-warning.csv",
      cloud_account_id: harness.accountA,
      control_totals: [
        {
          provider: "aws",
          service_code: "AmazonEC2",
          region: "us-west-2",
          month: "2026-02",
          line_count: "1",
          usage_quantity: "1.00000000",
          on_demand_cost_cents: "20",
          realized_cost_cents: "15",
          commitment_applied_cents: "10",
        },
      ],
    });
    const hidden = await harness.pool.query<{ id: string }>(
      `INSERT INTO import_batches
         (tenant_id, cloud_account_id, source, format, status, object_uri, schema_version, line_count)
       VALUES ($1, $2, 'synthetic', 'csv', 'completed', 'imports/synthetic/hidden-detail.csv',
               'synthetic_csv:v1', 1)
       RETURNING id`,
      [harness.tenantB, harness.accountB],
    );

    const detail = await harness.app.inject({
      method: "GET",
      url: `/api/imports/${created.json().id}`,
      headers: { "x-api-key": harness.analystApiKey },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      id: created.json().id,
      status: "completed",
      parser_warnings: [{ code: "UNKNOWN_OPTIONAL_FIELD", field: "note" }],
    });
    expect(detail.body).not.toMatch(/tenant_id|key_hash|plaintext/iu);

    const crossTenant = await harness.app.inject({
      method: "GET",
      url: `/api/imports/${hidden.rows[0]!.id}`,
      headers: importsAuthorization(harness),
    });
    expect(crossTenant.statusCode).toBe(404);
    expect(crossTenant.body).not.toContain(harness.tenantB);
  });
});

async function postImport(
  payload: Record<string, unknown>,
  headers = importsAuthorization(harness),
): Promise<Awaited<ReturnType<ImportsHarness["app"]["inject"]>>> {
  return await harness.app.inject({
    method: "POST",
    url: "/api/imports",
    headers: { "content-type": "application/json", ...headers },
    payload,
  });
}

async function importBatchCount(): Promise<number> {
  const result = await harness.pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM import_batches",
  );
  return result.rows[0]!.count;
}

async function usageControlTotals(importBatchId: string) {
  const result = await harness.pool.query(
    `SELECT provider,
            service_code,
            region,
            to_char(date_trunc('month', usage_start AT TIME ZONE 'UTC'), 'YYYY-MM') AS month,
            count(*)::text AS line_count,
            to_char(sum(usage_quantity), 'FM999999999999990.00000000') AS usage_quantity,
            sum(on_demand_cost_cents)::text AS on_demand_cost_cents,
            sum(realized_cost_cents)::text AS realized_cost_cents,
            sum(commitment_applied_cents)::text AS commitment_applied_cents
       FROM usage_line_items
      WHERE import_batch_id = $1
      GROUP BY provider, service_code, region, month
      ORDER BY service_code`,
    [importBatchId],
  );
  return result.rows;
}
