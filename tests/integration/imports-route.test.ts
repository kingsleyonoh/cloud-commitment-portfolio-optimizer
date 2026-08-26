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
        source: "azure_export",
        format: "manual_override",
        object_uri: "x.json",
        cloud_account_id: harness.accountA,
        control_totals: [],
      },
      {
        source: "aws_cur",
        format: "manual_override",
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

describe("POST /api/imports AWS CUR CSV", () => {
  it("imports AWS CUR CSV into canonical immutable usage rows with matching control totals", async () => {
    await putFixtureObject(
      harness,
      "imports/aws/cur-valid.csv",
      resolve("tests/fixtures/aws/cur-valid.csv"),
    );
    const response = await postImport({
      source: "aws_cur",
      format: "csv",
      object_uri: "imports/aws/cur-valid.csv",
      cloud_account_id: harness.accountA,
      control_totals: [
        {
          provider: "aws",
          service_code: "AmazonEC2",
          region: "us-east-1",
          month: "2026-03",
          line_count: "2",
          usage_quantity: "4.00000000",
          on_demand_cost_cents: "8",
          realized_cost_cents: "5",
          commitment_applied_cents: "3",
        },
        {
          provider: "aws",
          service_code: "AmazonS3",
          region: "us-east-1",
          month: "2026-03",
          line_count: "1",
          usage_quantity: "3.00000000",
          on_demand_cost_cents: "9",
          realized_cost_cents: "7",
          commitment_applied_cents: "2",
        },
      ],
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      cloud_account_id: harness.accountA,
      source: "aws_cur",
      format: "csv",
      status: "completed",
      object_uri: "imports/aws/cur-valid.csv",
      schema_version: "aws_cur_csv:v1",
      line_count: "3",
      error_details: {},
      parser_warnings: [],
    });
    expect(response.body).not.toMatch(/tenant_id|raw_row|stack|credential|authorization/iu);
    expect(await usageControlTotals(response.json().id)).toEqual([
      {
        provider: "aws",
        service_code: "AmazonEC2",
        region: "us-east-1",
        month: "2026-03",
        line_count: "2",
        usage_quantity: "4.00000000",
        on_demand_cost_cents: "8",
        realized_cost_cents: "5",
        commitment_applied_cents: "3",
      },
      {
        provider: "aws",
        service_code: "AmazonS3",
        region: "us-east-1",
        month: "2026-03",
        line_count: "1",
        usage_quantity: "3.00000000",
        on_demand_cost_cents: "9",
        realized_cost_cents: "7",
        commitment_applied_cents: "2",
      },
    ]);
  });

  it("quarantines AWS schema drift and records unknown optional CUR columns as warnings", async () => {
    await putFixtureObject(
      harness,
      "imports/aws/cur-invalid-missing-cost.csv",
      resolve("tests/fixtures/aws/cur-invalid-missing-cost.csv"),
    );
    const invalid = await postImport({
      source: "aws_cur",
      format: "csv",
      object_uri: "imports/aws/cur-invalid-missing-cost.csv",
      cloud_account_id: harness.accountA,
      control_totals: [],
    });
    expect(invalid.statusCode).toBe(201);
    expect(invalid.json()).toMatchObject({
      source: "aws_cur",
      status: "quarantined",
      schema_version: "aws_cur_csv:v1",
      line_count: "1",
      parser_warnings: [],
      error_details: { code: "IMPORT_SCHEMA_DRIFT" },
    });
    const rows = await harness.pool.query<{ count: string }>(
      "SELECT count(*) FROM usage_line_items WHERE import_batch_id = $1",
      [invalid.json().id],
    );
    expect(rows.rows[0]!.count).toBe("0");

    await putFixtureObject(
      harness,
      "imports/aws/cur-warning.csv",
      resolve("tests/fixtures/aws/cur-warning.csv"),
    );
    const warning = await postImport({
      source: "aws_cur",
      format: "csv",
      object_uri: "imports/aws/cur-warning.csv",
      cloud_account_id: harness.accountA,
      control_totals: [
        {
          provider: "aws",
          service_code: "AmazonEC2",
          region: "us-west-2",
          month: "2026-04",
          line_count: "1",
          usage_quantity: "1.00000000",
          on_demand_cost_cents: "20",
          realized_cost_cents: "15",
          commitment_applied_cents: "5",
        },
      ],
    });
    expect(warning.statusCode).toBe(201);
    expect(warning.json()).toMatchObject({
      source: "aws_cur",
      status: "completed",
      parser_warnings: [{ code: "UNKNOWN_OPTIONAL_FIELD", field: "lineItem/LegalEntity" }],
    });
  });
});

describe("POST /api/imports Phase 2 source-format matrix", () => {
  const cases = [
    {
      name: "AWS CUR Parquet",
      source: "aws_cur",
      format: "parquet",
      fixture: "tests/fixtures/aws/cur-valid.parquet",
      objectUri: "imports/aws/cur-valid.parquet",
      account: () => harness.accountA,
      total: total("aws", "AmazonEC2", "us-east-1", "2026-05", "2.00000000", "120", "90", "30"),
      schemaVersion: "aws_cur_parquet:v1",
    },
    {
      name: "AWS CUR JSON API snapshot",
      source: "aws_cur",
      format: "json_api_snapshot",
      fixture: "tests/fixtures/aws/cur-valid.json",
      objectUri: "imports/aws/cur-valid.json",
      account: () => harness.accountA,
      total: total("aws", "AmazonEC2", "us-east-1", "2026-05", "2.00000000", "120", "90", "30"),
      schemaVersion: "aws_cur_json_api_snapshot:v1",
    },
    {
      name: "Azure Cost Management CSV",
      source: "azure_export",
      format: "csv",
      fixture: "tests/fixtures/azure/export-valid.csv",
      objectUri: "imports/azure/export-valid.csv",
      account: () => harness.azureAccountA,
      total: total(
        "azure",
        "Microsoft.Compute",
        "eastus",
        "2026-05",
        "3.00000000",
        "240",
        "180",
        "60",
      ),
      schemaVersion: "azure_export_csv:v1",
    },
    {
      name: "Azure Cost Management Parquet",
      source: "azure_export",
      format: "parquet",
      fixture: "tests/fixtures/azure/export-valid.parquet",
      objectUri: "imports/azure/export-valid.parquet",
      account: () => harness.azureAccountA,
      total: total(
        "azure",
        "Microsoft.Compute",
        "eastus",
        "2026-05",
        "3.00000000",
        "240",
        "180",
        "60",
      ),
      schemaVersion: "azure_export_parquet:v1",
    },
    {
      name: "Azure Cost Management JSON API snapshot",
      source: "azure_export",
      format: "json_api_snapshot",
      fixture: "tests/fixtures/azure/export-valid.json",
      objectUri: "imports/azure/export-valid.json",
      account: () => harness.azureAccountA,
      total: total(
        "azure",
        "Microsoft.Compute",
        "eastus",
        "2026-05",
        "3.00000000",
        "240",
        "180",
        "60",
      ),
      schemaVersion: "azure_export_json_api_snapshot:v1",
    },
    {
      name: "GCP Billing Export CSV",
      source: "gcp_export",
      format: "csv",
      fixture: "tests/fixtures/gcp/export-valid.csv",
      objectUri: "imports/gcp/export-valid.csv",
      account: () => harness.gcpAccountA,
      total: total(
        "gcp",
        "Compute Engine",
        "us-central1",
        "2026-05",
        "4.00000000",
        "320",
        "224",
        "96",
      ),
      schemaVersion: "gcp_export_csv:v1",
    },
    {
      name: "GCP Billing Export Parquet",
      source: "gcp_export",
      format: "parquet",
      fixture: "tests/fixtures/gcp/export-valid.parquet",
      objectUri: "imports/gcp/export-valid.parquet",
      account: () => harness.gcpAccountA,
      total: total(
        "gcp",
        "Compute Engine",
        "us-central1",
        "2026-05",
        "4.00000000",
        "320",
        "224",
        "96",
      ),
      schemaVersion: "gcp_export_parquet:v1",
    },
    {
      name: "GCP Billing Export JSON API snapshot",
      source: "gcp_export",
      format: "json_api_snapshot",
      fixture: "tests/fixtures/gcp/export-valid.json",
      objectUri: "imports/gcp/export-valid.json",
      account: () => harness.gcpAccountA,
      total: total(
        "gcp",
        "Compute Engine",
        "us-central1",
        "2026-05",
        "4.00000000",
        "320",
        "224",
        "96",
      ),
      schemaVersion: "gcp_export_json_api_snapshot:v1",
    },
    {
      name: "Synthetic Scenario Generator Parquet",
      source: "synthetic",
      format: "parquet",
      fixture: "tests/fixtures/synthetic/usage-valid.parquet",
      objectUri: "imports/synthetic/usage-valid.parquet",
      account: () => harness.accountA,
      total: total("aws", "AmazonEC2", "us-east-1", "2026-05", "2.00000000", "120", "90", "30"),
      schemaVersion: "synthetic_parquet:v1",
    },
    {
      name: "Synthetic Scenario Generator JSON API snapshot",
      source: "synthetic",
      format: "json_api_snapshot",
      fixture: "tests/fixtures/synthetic/usage-valid.json",
      objectUri: "imports/synthetic/usage-valid.json",
      account: () => harness.accountA,
      total: total("aws", "AmazonEC2", "us-east-1", "2026-05", "2.00000000", "120", "90", "30"),
      schemaVersion: "synthetic_json_api_snapshot:v1",
    },
    {
      name: "Synthetic Scenario Generator manual override",
      source: "synthetic",
      format: "manual_override",
      fixture: "tests/fixtures/synthetic/manual-override-valid.json",
      objectUri: "imports/synthetic/manual-override-valid.json",
      account: () => harness.accountA,
      total: total("aws", "AmazonEC2", "us-east-1", "2026-05", "1.00000000", "100", "70", "30"),
      schemaVersion: "synthetic_manual_override:v1",
    },
  ] as const;

  it.each(cases)("$name imports with exact control-total reconciliation", async (entry) => {
    await putFixtureObject(harness, entry.objectUri, resolve(entry.fixture));
    const response = await postImport({
      source: entry.source,
      format: entry.format,
      object_uri: entry.objectUri,
      cloud_account_id: entry.account(),
      control_totals: [entry.total],
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      source: entry.source,
      format: entry.format,
      status: "completed",
      schema_version: entry.schemaVersion,
      line_count: "1",
      error_details: {},
      parser_warnings: [],
    });
    expect(await usageControlTotals(response.json().id)).toEqual([
      {
        provider: entry.total.provider,
        service_code: entry.total.service_code,
        region: entry.total.region,
        month: entry.total.month,
        line_count: "1",
        usage_quantity: entry.total.usage_quantity,
        on_demand_cost_cents: entry.total.on_demand_cost_cents,
        realized_cost_cents: entry.total.realized_cost_cents,
        commitment_applied_cents: entry.total.commitment_applied_cents,
      },
    ]);
  });

  it("keeps native CUR export unavailable until its Phase 3 owner", async () => {
    const response = await postImport({
      source: "aws_cur",
      format: "native_cur",
      object_uri: "imports/aws/native-cur.json",
      cloud_account_id: harness.accountA,
      control_totals: [],
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
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
      "source=oracle_export",
      "format=native_cur",
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
    const created = await postImport(
      {
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
      },
      { "x-api-key": harness.analystApiKey },
    );
    expect(created.statusCode).toBe(201);
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

function total(
  provider: "aws" | "azure" | "gcp",
  serviceCode: string,
  region: string,
  month: string,
  usageQuantity: string,
  onDemandCostCents: string,
  realizedCostCents: string,
  commitmentAppliedCents: string,
) {
  return {
    provider,
    service_code: serviceCode,
    region,
    month,
    line_count: "1",
    usage_quantity: usageQuantity,
    on_demand_cost_cents: onDemandCostCents,
    realized_cost_cents: realizedCostCents,
    commitment_applied_cents: commitmentAppliedCents,
  };
}
