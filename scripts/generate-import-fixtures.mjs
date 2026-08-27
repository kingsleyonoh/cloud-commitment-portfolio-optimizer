import { parquetWriteFile } from "hyparquet-writer";

const columns = [
  "provider",
  "service_code",
  "sku",
  "region",
  "usage_start",
  "usage_end",
  "usage_quantity",
  "usage_unit",
  "on_demand_cost_cents",
  "realized_cost_cents",
  "commitment_applied_cents",
  "tags",
];

const fixtures = [
  [
    "tests/fixtures/aws/cur-valid.parquet",
    {
      provider: "aws",
      service_code: "AmazonEC2",
      sku: "BoxUsage:m7g.large",
      region: "us-east-1",
      usage_start: "2026-05-01T00:00:00Z",
      usage_end: "2026-05-01T01:00:00Z",
      usage_quantity: "2.00000000",
      usage_unit: "Hrs",
      on_demand_cost_cents: "120",
      realized_cost_cents: "90",
      commitment_applied_cents: "30",
      tags: JSON.stringify({ Environment: "prod" }),
    },
  ],
  [
    "tests/fixtures/azure/export-valid.parquet",
    {
      provider: "azure",
      service_code: "Microsoft.Compute",
      sku: "Standard_D4s_v5",
      region: "eastus",
      usage_start: "2026-05-01T00:00:00Z",
      usage_end: "2026-05-01T01:00:00Z",
      usage_quantity: "3.00000000",
      usage_unit: "Hrs",
      on_demand_cost_cents: "240",
      realized_cost_cents: "180",
      commitment_applied_cents: "60",
      tags: JSON.stringify({ environment: "prod" }),
    },
  ],
  [
    "tests/fixtures/gcp/export-valid.parquet",
    {
      provider: "gcp",
      service_code: "Compute Engine",
      sku: "n2-standard-4",
      region: "us-central1",
      usage_start: "2026-05-01T00:00:00Z",
      usage_end: "2026-05-01T01:00:00Z",
      usage_quantity: "4.00000000",
      usage_unit: "Hrs",
      on_demand_cost_cents: "320",
      realized_cost_cents: "224",
      commitment_applied_cents: "96",
      tags: JSON.stringify({ environment: "prod" }),
    },
  ],
  [
    "tests/fixtures/synthetic/usage-valid.parquet",
    {
      provider: "aws",
      service_code: "AmazonEC2",
      sku: "m7g.large",
      region: "us-east-1",
      usage_start: "2026-05-01T00:00:00Z",
      usage_end: "2026-05-01T01:00:00Z",
      usage_quantity: "2.00000000",
      usage_unit: "Hrs",
      on_demand_cost_cents: "120",
      realized_cost_cents: "90",
      commitment_applied_cents: "30",
      tags: JSON.stringify({ environment: "synthetic" }),
    },
  ],
];

for (const [filename, row] of fixtures) {
  parquetWriteFile({
    filename,
    columnData: columns.map((name) => ({ name, data: [row[name]], type: "STRING" })),
    codec: "UNCOMPRESSED",
  });
}
