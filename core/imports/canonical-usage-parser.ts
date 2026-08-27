import { parquetReadObjects } from "hyparquet";

import { parseCsv } from "./csv.js";
import type { ImportControlTotal, ImportParseResult, UsageLineItemInput } from "./imports-types.js";

const REQUIRED_COLUMNS = [
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
] as const;

const REQUIRED_COLUMN_SET: ReadonlySet<string> = new Set(REQUIRED_COLUMNS);
const DECIMAL_8_PATTERN = /^(?:0|[1-9][0-9]{0,19})\.[0-9]{8}$/u;
const UNSIGNED_INTEGER_PATTERN = /^(?:0|[1-9][0-9]{0,18})$/u;

export async function parseCanonicalUsageImport(
  bytes: Buffer,
  accountProvider: "aws" | "azure" | "gcp",
  controlTotals: readonly ImportControlTotal[],
  format: "csv" | "parquet" | "json_api_snapshot" | "manual_override",
): Promise<ImportParseResult> {
  if (format === "csv") {
    return parseCanonicalCsvImport(bytes, accountProvider, controlTotals);
  }
  if (format === "parquet") {
    return parseCanonicalRows(
      await readParquetRows(bytes),
      accountProvider,
      controlTotals,
      "Canonical Parquet",
    );
  }
  return parseCanonicalJsonImport(bytes, accountProvider, controlTotals, format);
}

function parseCanonicalCsvImport(
  bytes: Buffer,
  accountProvider: "aws" | "azure" | "gcp",
  controlTotals: readonly ImportControlTotal[],
): ImportParseResult {
  const records = parseCsv(bytes.toString("utf8"));
  if (records.length < 2) return quarantine(0, "IMPORT_EMPTY", "Canonical CSV has no usage rows.");
  const [header = [], ...rows] = records;
  const headerValidation = validateHeader(header);
  if (headerValidation.kind === "quarantined") {
    return { ...headerValidation, lineCount: rows.length };
  }
  return parseCanonicalRows(
    rows.map((row) => Object.fromEntries(header.map((name, index) => [name, row[index] ?? ""]))),
    accountProvider,
    controlTotals,
    "Canonical CSV",
    headerValidation.parserWarnings,
  );
}

function parseCanonicalJsonImport(
  bytes: Buffer,
  accountProvider: "aws" | "azure" | "gcp",
  controlTotals: readonly ImportControlTotal[],
  format: "json_api_snapshot" | "manual_override",
): ImportParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    return quarantine(0, "IMPORT_SCHEMA_DRIFT", "Import JSON snapshot must be valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return quarantine(0, "IMPORT_SCHEMA_DRIFT", "Import JSON snapshot must be an object.");
  }
  const object = parsed as Record<string, unknown>;
  const expectedSchema =
    format === "manual_override" ? "manual_usage_override:v1" : "canonical_usage_snapshot:v1";
  if (object.schema_version !== expectedSchema || !Array.isArray(object.rows)) {
    return quarantine(0, "IMPORT_SCHEMA_DRIFT", "Import JSON snapshot schema is unsupported.");
  }
  if (format === "manual_override" && object.rows.length > 100) {
    return quarantine(
      0,
      "IMPORT_MANUAL_OVERRIDE_TOO_LARGE",
      "Manual overrides accept at most 100 rows.",
    );
  }
  return parseCanonicalRows(
    object.rows.map((row) =>
      row && typeof row === "object" ? (row as Record<string, unknown>) : {},
    ),
    accountProvider,
    controlTotals,
    format === "manual_override" ? "Manual override" : "Canonical JSON snapshot",
  );
}

async function readParquetRows(bytes: Buffer): Promise<readonly Record<string, unknown>[]> {
  const file = {
    byteLength: bytes.byteLength,
    slice(start: number, end?: number): ArrayBuffer {
      const view = bytes.subarray(start, end);
      return new Uint8Array(view).buffer;
    },
  };
  return (await parquetReadObjects({ file })) as readonly Record<string, unknown>[];
}

function validateHeader(header: readonly string[]):
  | Readonly<{ kind: "parsed"; parserWarnings: readonly Record<string, unknown>[] }>
  | Readonly<{
      kind: "quarantined";
      errorDetails: Record<string, unknown>;
      parserWarnings: readonly Record<string, unknown>[];
    }> {
  const missing = REQUIRED_COLUMNS.filter((column) => !header.includes(column));
  if (missing.length > 0) {
    return {
      kind: "quarantined",
      errorDetails: { code: "IMPORT_SCHEMA_DRIFT", missing_columns: missing },
      parserWarnings: [],
    };
  }
  const extra = header.filter((column) => !REQUIRED_COLUMN_SET.has(column));
  return {
    kind: "parsed",
    parserWarnings: Object.freeze(
      extra.map((field) => Object.freeze({ code: "UNKNOWN_OPTIONAL_FIELD", field })),
    ),
  };
}

function parseCanonicalRows(
  rows: readonly Record<string, unknown>[],
  accountProvider: "aws" | "azure" | "gcp",
  controlTotals: readonly ImportControlTotal[],
  label: string,
  parserWarnings: readonly Record<string, unknown>[] = [],
): ImportParseResult {
  if (rows.length < 1) return quarantine(0, "IMPORT_EMPTY", `${label} has no usage rows.`);
  const parsedRows: UsageLineItemInput[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const parsed = parseUsageRow(rows[index] ?? {}, index + 1, accountProvider);
    if (parsed.kind === "quarantined") {
      return { ...parsed, lineCount: rows.length, parserWarnings };
    }
    parsedRows.push(parsed.row);
  }
  const controlValidation = validateControlTotals(parsedRows, controlTotals);
  if (controlValidation) {
    return {
      kind: "quarantined",
      lineCount: rows.length,
      errorDetails: controlValidation,
      parserWarnings,
    };
  }
  return {
    kind: "parsed",
    parsed: Object.freeze({
      lineCount: rows.length,
      rows: Object.freeze(parsedRows),
      parserWarnings,
    }),
  };
}

function parseUsageRow(
  row: Record<string, unknown>,
  line: number,
  accountProvider: "aws" | "azure" | "gcp",
):
  | Readonly<{ kind: "parsed"; row: UsageLineItemInput }>
  | Readonly<{
      kind: "quarantined";
      errorDetails: Record<string, unknown>;
      parserWarnings: readonly Record<string, unknown>[];
    }> {
  try {
    const provider = stringValue(row.provider);
    if (provider !== "aws" && provider !== "azure" && provider !== "gcp")
      return rowError(line, "provider");
    if (provider !== accountProvider) return rowError(line, "provider");
    const usageStart = isoDate(stringValue(row.usage_start));
    const usageEnd = isoDate(stringValue(row.usage_end));
    if (!usageStart || !usageEnd || Date.parse(usageEnd) <= Date.parse(usageStart)) {
      return rowError(line, "usage_period");
    }
    const onDemandCostCents = integer(stringValue(row.on_demand_cost_cents));
    const realizedCostCents = integer(stringValue(row.realized_cost_cents));
    const commitmentAppliedCents = integer(stringValue(row.commitment_applied_cents));
    if (BigInt(commitmentAppliedCents) > BigInt(onDemandCostCents)) {
      return rowError(line, "commitment_applied_cents");
    }
    const tags = parseTags(row.tags);
    if (!tags) return rowError(line, "tags");
    return {
      kind: "parsed",
      row: Object.freeze({
        provider,
        serviceCode: text(stringValue(row.service_code)),
        sku: text(stringValue(row.sku)),
        region: text(stringValue(row.region)),
        usageStart,
        usageEnd,
        usageQuantity: decimal(stringValue(row.usage_quantity)),
        usageUnit: text(stringValue(row.usage_unit)),
        onDemandCostCents,
        realizedCostCents,
        commitmentAppliedCents,
        tags,
      }),
    };
  } catch {
    return rowError(line, "required_field");
  }
}

function validateControlTotals(
  rows: readonly UsageLineItemInput[],
  expected: readonly ImportControlTotal[],
): Record<string, unknown> | null {
  const actual = new Map<string, MutableTotal>();
  for (const row of rows) {
    const month = row.usageStart.slice(0, 7);
    const key = totalKey(row.provider, row.serviceCode, row.region, month);
    const current = actual.get(key) ?? {
      provider: row.provider,
      serviceCode: row.serviceCode,
      region: row.region,
      month,
      lineCount: 0n,
      usageQuantity: 0n,
      onDemandCostCents: 0n,
      realizedCostCents: 0n,
      commitmentAppliedCents: 0n,
    };
    current.lineCount += 1n;
    current.usageQuantity += parseScaledDecimal(row.usageQuantity);
    current.onDemandCostCents += BigInt(row.onDemandCostCents);
    current.realizedCostCents += BigInt(row.realizedCostCents);
    current.commitmentAppliedCents += BigInt(row.commitmentAppliedCents);
    actual.set(key, current);
  }
  const expectedMap = new Map(expected.map((total) => [controlTotalKey(total), total]));
  if (actual.size !== expectedMap.size) return { code: "IMPORT_CONTROL_TOTAL_MISMATCH" };
  for (const [key, total] of actual) {
    const candidate = expectedMap.get(key);
    if (!candidate || !matchesTotal(total, candidate)) {
      return { code: "IMPORT_CONTROL_TOTAL_MISMATCH" };
    }
  }
  return null;
}

function matchesTotal(actual: MutableTotal, expected: ImportControlTotal): boolean {
  return (
    actual.lineCount.toString() === expected.lineCount &&
    scaledDecimalText(actual.usageQuantity) === expected.usageQuantity &&
    actual.onDemandCostCents.toString() === expected.onDemandCostCents &&
    actual.realizedCostCents.toString() === expected.realizedCostCents &&
    actual.commitmentAppliedCents.toString() === expected.commitmentAppliedCents
  );
}

interface MutableTotal {
  provider: "aws" | "azure" | "gcp";
  serviceCode: string;
  region: string;
  month: string;
  lineCount: bigint;
  usageQuantity: bigint;
  onDemandCostCents: bigint;
  realizedCostCents: bigint;
  commitmentAppliedCents: bigint;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function controlTotalKey(total: ImportControlTotal): string {
  return totalKey(total.provider, total.serviceCode, total.region, total.month);
}

function totalKey(provider: string, serviceCode: string, region: string, month: string): string {
  return `${provider}\0${serviceCode}\0${region}\0${month}`;
}

function text(value: string): string {
  const trimmed = value.normalize("NFC").trim();
  if (!trimmed || hasControlCharacter(trimmed)) throw new Error("invalid text");
  return trimmed;
}

function decimal(value: string): string {
  const trimmed = value.trim();
  if (!DECIMAL_8_PATTERN.test(trimmed)) throw new Error("invalid decimal");
  return trimmed;
}

function integer(value: string): string {
  const trimmed = value.trim();
  if (!UNSIGNED_INTEGER_PATTERN.test(trimmed)) throw new Error("invalid integer");
  return trimmed;
}

function isoDate(value: string): string | null {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed.toISOString();
}

function parseTags(value: unknown): Record<string, unknown> | null {
  try {
    const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const encoded = JSON.stringify(parsed);
    if (/password|secret|token|credential/iu.test(encoded)) return null;
    return Object.freeze({ ...(parsed as Record<string, unknown>) });
  } catch {
    return null;
  }
}

function parseScaledDecimal(value: string): bigint {
  const [whole, fraction] = value.split(".") as [string, string];
  return BigInt(whole) * 100_000_000n + BigInt(fraction);
}

function scaledDecimalText(value: bigint): string {
  const whole = value / 100_000_000n;
  const fraction = (value % 100_000_000n).toString().padStart(8, "0");
  return `${whole}.${fraction}`;
}

function rowError(
  line: number,
  field: string,
): Readonly<{
  kind: "quarantined";
  errorDetails: Record<string, unknown>;
  parserWarnings: readonly Record<string, unknown>[];
}> {
  return {
    kind: "quarantined",
    errorDetails: { code: "IMPORT_ROW_INVALID", line, field },
    parserWarnings: [],
  };
}

function quarantine(
  lineCount: number,
  code: string,
  message: string,
): Readonly<{
  kind: "quarantined";
  lineCount: number;
  errorDetails: Record<string, unknown>;
  parserWarnings: readonly Record<string, unknown>[];
}> {
  return { kind: "quarantined", lineCount, errorDetails: { code, message }, parserWarnings: [] };
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
    ) {
      return true;
    }
  }
  return false;
}
