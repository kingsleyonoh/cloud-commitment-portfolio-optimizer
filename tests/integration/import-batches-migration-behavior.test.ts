import { resolve } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../core/db/migrations.js";
import {
  createIsolatedDatabase,
  dropIsolatedDatabase,
  type IsolatedDatabase,
} from "./helpers/postgres-database.js";

const migrationsDirectory = resolve("db/migrations");
let database: IsolatedDatabase | undefined;
let client: Client;

async function tenant(label: string): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO tenants (name, legal_name, full_legal_name, display_name)
     VALUES ($1, $1, $1, $1) RETURNING id`,
    [label],
  );
  return result.rows[0]!.id;
}

async function batch(tenantId: string, source = "synthetic", format = "csv") {
  return client.query<{
    id: string;
    status: string;
    line_count: string;
    error_details: object;
    parser_warnings: unknown[];
    created_at: Date;
    updated_at: Date;
  }>(
    `INSERT INTO import_batches
       (tenant_id, source, format, object_uri, schema_version)
     VALUES ($1, $2, $3, 'imports/synthetic/input.csv', 'synthetic:v1')
     RETURNING id, status, line_count, error_details, parser_warnings, created_at, updated_at`,
    [tenantId, source, format],
  );
}

beforeAll(async () => {
  database = await createIsolatedDatabase("ccpo_import_batches_behavior");
  await runMigrations({ databaseUrl: database.url, migrationsDirectory });
  client = new Client({ connectionString: database.url });
  await client.connect();
});

afterAll(async () => {
  if (client) await client.end();
  await dropIsolatedDatabase(database);
});

describe("import source and parser lifecycle metadata", () => {
  it("defaults every new import to a resumable empty queued state", async () => {
    const tenantId = await tenant("Queued import tenant");
    const result = await batch(tenantId);
    expect(result.rows[0]).toMatchObject({
      status: "queued",
      line_count: "0",
      error_details: {},
      parser_warnings: [],
    });
  });

  it.each(["aws_cur", "azure_export", "gcp_export", "synthetic"])(
    "accepts canonical source %s",
    async (source) => {
      const tenantId = await tenant(`Source ${source} tenant`);
      await expect(batch(tenantId, source)).resolves.toBeDefined();
    },
  );

  it.each(["csv", "parquet", "json_api_snapshot", "native_cur", "manual_override"])(
    "accepts canonical format %s",
    async (format) => {
      const tenantId = await tenant(`Format ${format} tenant`);
      await expect(batch(tenantId, "synthetic", format)).resolves.toBeDefined();
    },
  );

  it.each(["", "AWS_CUR", "aws_cur ", "unknown"])(
    "rejects unsupported source %j",
    async (source) => {
      const tenantId = await tenant(`Invalid source ${JSON.stringify(source)}`);
      await expect(batch(tenantId, source)).rejects.toMatchObject({
        constraint: "import_batches_source_check",
      });
    },
  );

  it.each(["", "CSV", "csv ", "xml"])("rejects unsupported format %j", async (format) => {
    const tenantId = await tenant(`Invalid format ${JSON.stringify(format)}`);
    await expect(batch(tenantId, "synthetic", format)).rejects.toMatchObject({
      constraint: "import_batches_format_check",
    });
  });

  it.each([
    ["queued", 0, "{}", "[]"],
    ["processing", 0, "{}", "[]"],
    ["completed", 12, "{}", '[{"code":"optional_field"}]'],
    ["failed", 0, '{"code":"parser_failed"}', "[]"],
    ["quarantined", 7, '{"code":"schema_drift"}', '[{"code":"optional_field"}]'],
    ["cancelled", 0, '{"code":"operator_cancelled"}', "[]"],
  ])("accepts canonical %s lifecycle metadata", async (status, count, errors, warnings) => {
    const tenantId = await tenant(`Status ${status} tenant`);
    const created = await batch(tenantId);
    await expect(
      client.query(
        `UPDATE import_batches SET status = $1, line_count = $2,
         error_details = $3::jsonb, parser_warnings = $4::jsonb WHERE id = $5`,
        [status, count, errors, warnings, created.rows[0]!.id],
      ),
    ).resolves.toBeDefined();
  });

  it.each(["", "pending", "complete", "quarantine", "QUEUED"])(
    "rejects unsupported lifecycle status %j",
    async (status) => {
      const tenantId = await tenant(`Invalid status ${JSON.stringify(status)}`);
      const created = await batch(tenantId);
      await expect(
        client.query("UPDATE import_batches SET status = $1 WHERE id = $2", [
          status,
          created.rows[0]!.id,
        ]),
      ).rejects.toMatchObject({ constraint: "import_batches_status_check" });
    },
  );
});

describe("import parser metadata validation", () => {
  it.each([
    ["object_uri", ""],
    ["object_uri", " imports/padded.csv "],
    ["schema_version", ""],
    ["schema_version", " synthetic:v1 "],
  ])("rejects noncanonical %s value %j", async (column, value) => {
    const tenantId = await tenant(`Invalid ${column} tenant`);
    const query = `INSERT INTO import_batches
      (tenant_id, source, format, object_uri, schema_version)
      VALUES ($1, 'synthetic', 'csv', $2, $3)`;
    const values =
      column === "object_uri" ? [tenantId, value, "synthetic:v1"] : [tenantId, "x", value];
    await expect(client.query(query, values)).rejects.toThrow(
      new RegExp(`import_batches_${column}_trimmed_check`, "iu"),
    );
  });

  it("rejects negative line counts and wrong JSON metadata shapes", async () => {
    const tenantId = await tenant("Invalid parser metadata tenant");
    const created = await batch(tenantId);
    const id = created.rows[0]!.id;
    await expect(
      client.query("UPDATE import_batches SET line_count = -1 WHERE id = $1", [id]),
    ).rejects.toMatchObject({ constraint: "import_batches_line_count_nonnegative_check" });
    await expect(
      client.query("UPDATE import_batches SET error_details = '[]' WHERE id = $1", [id]),
    ).rejects.toMatchObject({ constraint: "import_batches_error_details_object_check" });
    await expect(
      client.query("UPDATE import_batches SET parser_warnings = '{}' WHERE id = $1", [id]),
    ).rejects.toMatchObject({ constraint: "import_batches_parser_warnings_array_check" });
  });

  it("stores quarantine errors and warnings and advances database-managed updated_at", async () => {
    const tenantId = await tenant("Quarantined import tenant");
    const before = (await batch(tenantId)).rows[0]!;
    await client.query("SELECT pg_sleep(0.02)");
    const after = await client.query<{
      status: string;
      error_details: object;
      parser_warnings: object[];
      created_at: Date;
      updated_at: Date;
    }>(
      `UPDATE import_batches SET status = 'quarantined',
       error_details = '{"code":"missing_required_cost"}',
       parser_warnings = '[{"code":"unknown_optional_field"}]',
       updated_at = '2000-01-01' WHERE id = $1
       RETURNING status, error_details, parser_warnings, created_at, updated_at`,
      [before.id],
    );
    expect(after.rows[0]).toMatchObject({
      status: "quarantined",
      error_details: { code: "missing_required_cost" },
      parser_warnings: [{ code: "unknown_optional_field" }],
      created_at: before.created_at,
    });
    expect(after.rows[0]!.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
  });
});
