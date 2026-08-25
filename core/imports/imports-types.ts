export type ImportSource = "synthetic" | "aws_cur" | "azure_export" | "gcp_export";
export type ImportFormat =
  "csv" | "parquet" | "json_api_snapshot" | "native_cur" | "manual_override";
export type ImportStatus =
  "queued" | "processing" | "completed" | "failed" | "quarantined" | "cancelled";

export type ImportBatchRecord = Readonly<{
  id: string;
  cloudAccountId: string | null;
  source: ImportSource;
  format: ImportFormat;
  status: ImportStatus;
  objectUri: string;
  schemaVersion: string;
  lineCount: string;
  errorDetails: Record<string, unknown>;
  parserWarnings: readonly Record<string, unknown>[];
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type ImportBatch = Readonly<{
  id: string;
  cloud_account_id: string | null;
  source: ImportSource;
  format: ImportFormat;
  status: ImportStatus;
  object_uri: string;
  schema_version: string;
  line_count: string;
  error_details: Record<string, unknown>;
  parser_warnings: readonly Record<string, unknown>[];
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}>;

export type ImportBatchListPage = Readonly<{
  imports: readonly ImportBatch[];
  next_cursor: string | null;
}>;

export type ImportBatchCursorBoundary = Readonly<{
  createdAt: string;
  id: string;
}>;

export type ImportBatchListInput = Readonly<{
  limit: number;
  cursor?: ImportBatchCursorBoundary;
  source?: "synthetic" | "aws_cur";
  format?: "csv";
  status?: ImportStatus;
  cloudAccountId?: string;
}>;

export type ImportControlTotal = Readonly<{
  provider: "aws" | "azure" | "gcp";
  serviceCode: string;
  region: string;
  month: string;
  lineCount: string;
  usageQuantity: string;
  onDemandCostCents: string;
  realizedCostCents: string;
  commitmentAppliedCents: string;
}>;

export type ImportCreateInput = Readonly<{
  source: "synthetic" | "aws_cur";
  format: "csv";
  objectUri: string;
  cloudAccountId: string;
  controlTotals: readonly ImportControlTotal[];
}>;

export type UsageLineItemInput = Readonly<{
  provider: "aws" | "azure" | "gcp";
  serviceCode: string;
  sku: string;
  region: string;
  usageStart: string;
  usageEnd: string;
  usageQuantity: string;
  usageUnit: string;
  onDemandCostCents: string;
  realizedCostCents: string;
  commitmentAppliedCents: string;
  tags: Record<string, unknown>;
}>;

export type ParsedSyntheticCsv = Readonly<{
  lineCount: number;
  rows: readonly UsageLineItemInput[];
  parserWarnings: readonly Record<string, unknown>[];
}>;

export type ImportParseResult =
  | Readonly<{ kind: "parsed"; parsed: ParsedSyntheticCsv }>
  | Readonly<{
      kind: "quarantined";
      lineCount: number;
      errorDetails: Record<string, unknown>;
      parserWarnings: readonly Record<string, unknown>[];
    }>;
