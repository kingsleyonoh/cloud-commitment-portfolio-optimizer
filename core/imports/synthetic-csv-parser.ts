import type {
  ImportControlTotal,
  ImportParseResult,
  ParsedSyntheticCsv,
  UsageLineItemInput,
} from "./imports-types.js";

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

export function parseSyntheticCsvImport(
  bytes: Buffer,
  accountProvider: "aws" | "azure" | "gcp",
  controlTotals: readonly ImportControlTotal[],
): ImportParseResult {
  const text = bytes.toString("utf8");
  const records = parseCsv(text);
  if (records.length < 2) return quarantine(0, "IMPORT_EMPTY", "Synthetic CSV has no usage rows.");
  const [header = [], ...rows] = records;
  const headerValidation = validateHeader(header);
  if (headerValidation.kind === "quarantined") {
    return { ...headerValidation, lineCount: rows.length };
  }
  const parsedRows: UsageLineItemInput[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    const parsed = parseUsageRow(header, row, index + 2, accountProvider);
    if (parsed.kind === "quarantined") return { ...parsed, lineCount: rows.length };
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
    } satisfies ParsedSyntheticCsv),
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
  const extra = header.filter((column) => !REQUIRED_COLUMN_SET.has(column));
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
  accountProvider: "aws" | "azure" | "gcp",
):
  | Readonly<{ kind: "parsed"; row: UsageLineItemInput }>
  | Readonly<{
      kind: "quarantined";
      errorDetails: Record<string, unknown>;
      parserWarnings: readonly Record<string, unknown>[];
    }> {
  try {
    const value = (column: (typeof REQUIRED_COLUMNS)[number]) => row[header.indexOf(column)] ?? "";
    const provider = value("provider");
    if (provider !== "aws" && provider !== "azure" && provider !== "gcp") {
      return rowError(line, "provider");
    }
    if (provider !== accountProvider) return rowError(line, "provider");
    const usageStart = isoDate(value("usage_start"));
    const usageEnd = isoDate(value("usage_end"));
    if (!usageStart || !usageEnd || Date.parse(usageEnd) <= Date.parse(usageStart)) {
      return rowError(line, "usage_period");
    }
    const onDemandCostCents = integer(value("on_demand_cost_cents"));
    const realizedCostCents = integer(value("realized_cost_cents"));
    const commitmentAppliedCents = integer(value("commitment_applied_cents"));
    if (BigInt(commitmentAppliedCents) > BigInt(onDemandCostCents)) {
      return rowError(line, "commitment_applied_cents");
    }
    const tags = parseTags(value("tags"));
    if (!tags) return rowError(line, "tags");
    return {
      kind: "parsed",
      row: Object.freeze({
        provider,
        serviceCode: text(value("service_code")),
        sku: text(value("sku")),
        region: text(value("region")),
        usageStart,
        usageEnd,
        usageQuantity: decimal(value("usage_quantity")),
        usageUnit: text(value("usage_unit")),
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

function controlTotalKey(total: ImportControlTotal): string {
  return totalKey(total.provider, total.serviceCode, total.region, total.month);
}

function totalKey(provider: string, serviceCode: string, region: string, month: string): string {
  return `${provider}\0${serviceCode}\0${region}\0${month}`;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (character !== "\r") {
      cell += character;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((record) => record.some((value) => value.trim() !== ""));
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

function parseTags(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
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
