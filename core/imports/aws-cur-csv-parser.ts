import { parseCsv } from "./csv.js";
import type { ImportControlTotal, ImportParseResult, UsageLineItemInput } from "./imports-types.js";

const REQUIRED_COLUMNS = [
  "lineItem/UsageAccountId",
  "lineItem/ProductCode",
  "lineItem/UsageType",
  "product/region",
  "lineItem/UsageStartDate",
  "lineItem/UsageEndDate",
  "lineItem/UsageAmount",
  "lineItem/UsageUnit",
  "pricing/publicOnDemandCost",
  "lineItem/UnblendedCost",
] as const;

const KNOWN_OPTIONAL_COLUMNS: ReadonlySet<string> = new Set([
  "savingsPlan/SavingsPlanEffectiveCost",
  "resourceTags/user:Environment",
]);

const REQUIRED_COLUMN_SET: ReadonlySet<string> = new Set(REQUIRED_COLUMNS);
const DECIMAL_8_PATTERN = /^(?:0|[1-9][0-9]{0,19})\.[0-9]{8}$/u;
const MONEY_PATTERN = /^(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,10})?$/u;

export function parseAwsCurCsvImport(
  bytes: Buffer,
  accountProvider: "aws" | "azure" | "gcp",
  controlTotals: readonly ImportControlTotal[],
): ImportParseResult {
  if (accountProvider !== "aws") {
    return quarantine(
      0,
      "IMPORT_ACCOUNT_PROVIDER_MISMATCH",
      "AWS CUR imports require an AWS account.",
    );
  }
  const records = parseCsv(bytes.toString("utf8"));
  if (records.length < 2) return quarantine(0, "IMPORT_EMPTY", "AWS CUR CSV has no usage rows.");
  const [header = [], ...rows] = records;
  const headerValidation = validateHeader(header);
  if (headerValidation.kind === "quarantined")
    return { ...headerValidation, lineCount: rows.length };

  const parsedRows: UsageLineItemInput[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const parsed = parseUsageRow(header, rows[index] ?? [], index + 2);
    if (parsed.kind === "quarantined") {
      return { ...parsed, lineCount: rows.length, parserWarnings: headerValidation.parserWarnings };
    }
    parsedRows.push(parsed.row);
  }
  const controlValidation = validateControlTotals(parsedRows, controlTotals);
  if (controlValidation) {
    return {
      kind: "quarantined",
      lineCount: rows.length,
      errorDetails: controlValidation,
      parserWarnings: headerValidation.parserWarnings,
    };
  }
  return {
    kind: "parsed",
    parsed: Object.freeze({
      lineCount: rows.length,
      rows: Object.freeze(parsedRows),
      parserWarnings: headerValidation.parserWarnings,
    }),
  };
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
  const extra = header.filter(
    (column) => !REQUIRED_COLUMN_SET.has(column) && !KNOWN_OPTIONAL_COLUMNS.has(column),
  );
  return {
    kind: "parsed",
    parserWarnings: Object.freeze(
      extra.map((field) => Object.freeze({ code: "UNKNOWN_OPTIONAL_FIELD", field })),
    ),
  };
}

function parseUsageRow(
  header: readonly string[],
  row: readonly string[],
  line: number,
):
  | Readonly<{ kind: "parsed"; row: UsageLineItemInput }>
  | Readonly<{
      kind: "quarantined";
      errorDetails: Record<string, unknown>;
      parserWarnings: readonly Record<string, unknown>[];
    }> {
  try {
    const value = (column: string) => row[header.indexOf(column)] ?? "";
    const usageStart = isoDate(value("lineItem/UsageStartDate"));
    const usageEnd = isoDate(value("lineItem/UsageEndDate"));
    if (!usageStart || !usageEnd || Date.parse(usageEnd) <= Date.parse(usageStart)) {
      return rowError(line, "usage_period");
    }
    const onDemandCostCents = moneyCents(value("pricing/publicOnDemandCost"));
    const realizedCostCents = moneyCents(
      value("savingsPlan/SavingsPlanEffectiveCost") || value("lineItem/UnblendedCost"),
    );
    const commitmentAppliedCents =
      BigInt(onDemandCostCents) > BigInt(realizedCostCents)
        ? (BigInt(onDemandCostCents) - BigInt(realizedCostCents)).toString()
        : "0";
    return {
      kind: "parsed",
      row: Object.freeze({
        provider: "aws",
        serviceCode: text(value("lineItem/ProductCode")),
        sku: text(value("lineItem/UsageType")),
        region: text(value("product/region")),
        usageStart,
        usageEnd,
        usageQuantity: decimal8(value("lineItem/UsageAmount")),
        usageUnit: text(value("lineItem/UsageUnit")),
        onDemandCostCents,
        realizedCostCents,
        commitmentAppliedCents,
        tags: tags(header, row),
      }),
    };
  } catch {
    return rowError(line, "required_field");
  }
}

function tags(header: readonly string[], row: readonly string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const column of header) {
    if (!column.startsWith("resourceTags/user:")) continue;
    const raw = row[header.indexOf(column)]?.normalize("NFC").trim();
    if (raw) result[column.slice("resourceTags/user:".length)] = raw;
  }
  return Object.freeze(result);
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

function decimal8(value: string): string {
  const trimmed = value.trim();
  if (!DECIMAL_8_PATTERN.test(trimmed)) throw new Error("invalid decimal");
  return trimmed;
}

function moneyCents(value: string): string {
  const trimmed = value.trim();
  if (!MONEY_PATTERN.test(trimmed)) throw new Error("invalid money");
  const [whole, fraction = ""] = trimmed.split(".") as [string, string?];
  const scale = 10_000_000_000n;
  const scaled = BigInt(whole) * scale + BigInt(fraction.padEnd(10, "0"));
  return ((scaled * 100n + scale / 2n) / scale).toString();
}

function isoDate(value: string): string | null {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed.toISOString();
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
