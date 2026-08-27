import { resolve } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../core/db/migrations.js";
import { insertImportTenant, validImportMetadata } from "./helpers/import-batches-schema.js";
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
  database = await createIsolatedDatabase("ccpo_import_batches_validation");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  client = new Client({ connectionString: database.url });
  await client.connect();
  tenantId = await insertImportTenant(client, "Import validation tenant");
});

afterAll(async () => {
  if (client) await client.end();
  await dropIsolatedDatabase(database);
});

async function expectRejected(
  overrides: Record<string, string | number>,
  constraint: string,
): Promise<void> {
  const values = {
    source: validImportMetadata.source,
    format: validImportMetadata.format,
    status: "queued",
    objectUri: validImportMetadata.objectUri,
    schemaVersion: validImportMetadata.schemaVersion,
    lineCount: 0,
    errorDetails: "{}",
    parserWarnings: "[]",
    ...overrides,
  };
  await expect(
    client.query(
      `INSERT INTO import_batches
         (tenant_id, source, format, status, object_uri, schema_version, line_count,
          error_details, parser_warnings)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)`,
      [
        tenantId,
        values.source,
        values.format,
        values.status,
        values.objectUri,
        values.schemaVersion,
        values.lineCount,
        values.errorDetails,
        values.parserWarnings,
      ],
    ),
  ).rejects.toMatchObject({ constraint });
}

describe("import source and parser metadata validation", () => {
  it.each(["aws_cur", "azure_export", "gcp_export", "synthetic"])(
    "accepts canonical source %s",
    async (source) => {
      await expect(
        client.query(
          `INSERT INTO import_batches
             (tenant_id, source, format, object_uri, schema_version)
           VALUES ($1, $2, 'csv', $3, $4)`,
          [tenantId, source, validImportMetadata.objectUri, validImportMetadata.schemaVersion],
        ),
      ).resolves.toBeDefined();
    },
  );

  it.each(["csv", "parquet", "json_api_snapshot", "native_cur", "manual_override"])(
    "accepts canonical format %s",
    async (format) => {
      await expect(
        client.query(
          `INSERT INTO import_batches
             (tenant_id, source, format, object_uri, schema_version)
           VALUES ($1, 'synthetic', $2, $3, $4)`,
          [tenantId, format, validImportMetadata.objectUri, validImportMetadata.schemaVersion],
        ),
      ).resolves.toBeDefined();
    },
  );

  it.each(["AWS_CUR", "synthetic ", "billing_file"])("rejects source %j", async (source) => {
    await expectRejected({ source }, "import_batches_source_check");
  });

  it.each(["CSV", " csv", "xml"])("rejects format %j", async (format) => {
    await expectRejected({ format }, "import_batches_format_check");
  });

  it.each(["", "   ", " imports/synthetic/file.csv ", "x".repeat(2049)])(
    "rejects blank, padded, or unbounded object URI %j",
    async (objectUri) => {
      await expectRejected({ objectUri }, "import_batches_object_uri_trimmed_check");
    },
  );

  it.each(["", "   ", " synthetic_csv:v1 ", "v".repeat(129)])(
    "rejects blank, padded, or unbounded schema/parser version %j",
    async (schemaVersion) => {
      await expectRejected({ schemaVersion }, "import_batches_schema_version_trimmed_check");
    },
  );

  it("rejects negative line counts", async () => {
    await expectRejected({ lineCount: -1 }, "import_batches_line_count_nonnegative_check");
  });

  it.each(["[]", '"message"', "null"])("rejects non-object errors %s", async (errorDetails) => {
    await expectRejected({ errorDetails }, "import_batches_error_details_object_check");
  });

  it.each([
    "stack",
    "stack_trace",
    "raw_file",
    "raw_bytes",
    "raw_row",
    "raw_rows",
    "row_payload",
    "credentials",
  ])("rejects forbidden error payload key %s", async (key) => {
    await expectRejected(
      { status: "failed", errorDetails: JSON.stringify({ [key]: "omitted" }) },
      "import_batches_error_details_object_check",
    );
  });

  it("rejects unbounded error metadata", async () => {
    await expectRejected(
      { status: "failed", errorDetails: JSON.stringify({ message: "x".repeat(8192) }) },
      "import_batches_error_details_object_check",
    );
  });

  it.each(["{}", '"warning"', "null"])(
    "rejects non-array parser warnings %s",
    async (parserWarnings) => {
      await expectRejected({ parserWarnings }, "import_batches_parser_warnings_array_check");
    },
  );

  it("rejects unbounded parser warning metadata", async () => {
    await expectRejected(
      { status: "completed", parserWarnings: JSON.stringify(["x".repeat(65536)]) },
      "import_batches_parser_warnings_array_check",
    );
  });
});

describe("import lifecycle field coupling", () => {
  it.each([
    ["queued", 1, "{}", "[]", "import_batches_line_count_nonnegative_check"],
    [
      "queued",
      0,
      "{}",
      '[{"code":"premature_warning"}]',
      "import_batches_parser_warnings_array_check",
    ],
    [
      "processing",
      0,
      '{"code":"premature_error"}',
      "[]",
      "import_batches_error_details_object_check",
    ],
    [
      "completed",
      1,
      '{"code":"unexpected_error"}',
      "[]",
      "import_batches_error_details_object_check",
    ],
    ["failed", 0, "{}", "[]", "import_batches_error_details_object_check"],
    ["quarantined", 0, "{}", "[]", "import_batches_error_details_object_check"],
    ["cancelled", 0, "{}", "[]", "import_batches_error_details_object_check"],
  ])(
    "rejects invalid %s count/error/warning coupling",
    async (status, lineCount, errorDetails, parserWarnings, constraint) => {
      await expectRejected({ status, lineCount, errorDetails, parserWarnings }, constraint);
    },
  );

  it("rejects reversed timestamps", async () => {
    await expect(
      client.query(
        `INSERT INTO import_batches
           (tenant_id, source, format, object_uri, schema_version, created_at, updated_at)
         VALUES ($1, 'synthetic', 'csv', $2, $3,
                 '2026-01-02T00:00:00Z', '2026-01-01T00:00:00Z')`,
        [tenantId, validImportMetadata.objectUri, validImportMetadata.schemaVersion],
      ),
    ).rejects.toMatchObject({ constraint: "import_batches_timestamps_ordered_check" });
  });
});
