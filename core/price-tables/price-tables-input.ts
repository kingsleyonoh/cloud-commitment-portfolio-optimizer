import { createHash } from "node:crypto";

import { AppError } from "../shared/errors.js";
import type {
  PriceTableCreateInput,
  PriceTableInstrument,
  PriceTableListInput,
  PriceTablePaymentOption,
  PriceTableProvider,
  PriceTableStatus,
} from "./price-tables-types.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DATE_PATTERN = /^[0-9]{4}-(?:0[1-9]|1[0-2])-[0-3][0-9]$/u;
const OBJECT_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,2047}$/u;
const UNSIGNED_INTEGER_PATTERN = /^(?:0|[1-9][0-9]{0,18})$/u;

export function parsePriceTableCreateBody(body: unknown): PriceTableCreateInput {
  return parseAwsComputeSavingsPlanPriceTable(body);
}

export function parseAwsComputeSavingsPlanPriceTable(body: unknown): PriceTableCreateInput {
  const object = closedRecord(body);
  rejectUnknown(
    object,
    new Set([
      "provider",
      "instrument",
      "version_label",
      "effective_from",
      "effective_to",
      "source_uri",
      "items",
    ]),
  );
  const provider = parseProvider(object.provider);
  const instrument = parseInstrument(object.instrument);
  if (provider !== "aws" || instrument !== "aws_compute_savings_plan") throw invalid();
  if (!Array.isArray(object.items) || object.items.length < 1 || object.items.length > 5000) {
    throw invalid();
  }
  const input = {
    provider,
    instrument,
    versionLabel: cleanText(object.version_label, 1, 128),
    effectiveFrom: dateValue(object.effective_from),
    effectiveTo: nullableDate(object.effective_to),
    sourceUri: objectKey(object.source_uri),
    items: Object.freeze(object.items.map(priceItem)),
  } as const;
  if (input.effectiveTo && input.effectiveTo < input.effectiveFrom) throw invalid();
  return Object.freeze({ ...input, checksum: checksum(input) });
}

export function parsePriceTableId(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw invalid();
  return value;
}

export function parsePriceTableListQuery(query: unknown): PriceTableListInput {
  const object = closedRecord(query);
  rejectUnknown(object, new Set(["limit", "cursor", "provider", "instrument", "status"]));
  return Object.freeze({
    limit: parseLimit(object.limit),
    ...(object.provider === undefined ? {} : { provider: parseProvider(object.provider) }),
    ...(object.instrument === undefined ? {} : { instrument: parseInstrument(object.instrument) }),
    ...(object.status === undefined ? {} : { status: parseStatus(object.status) }),
  });
}

function priceItem(value: unknown) {
  const object = closedRecord(value);
  rejectUnknown(
    object,
    new Set([
      "sku",
      "region",
      "term_months",
      "payment_option",
      "hourly_rate_cents",
      "upfront_cents",
      "coverage_rules",
    ]),
  );
  const termMonths = term(object.term_months);
  const paymentOption = payment(object.payment_option);
  const coverageRules = coverage(object.coverage_rules);
  if (coverageRules.service_code !== "AmazonEC2" || coverageRules.usage_family !== "compute") {
    throw invalid();
  }
  return Object.freeze({
    sku: cleanText(object.sku, 1, 512),
    region: cleanText(object.region, 1, 128),
    termMonths,
    paymentOption,
    hourlyRateCents: unsignedInteger(object.hourly_rate_cents),
    upfrontCents: unsignedInteger(object.upfront_cents),
    coverageRules: Object.freeze({ ...coverageRules }),
  });
}

function parseProvider(value: unknown): PriceTableProvider {
  if (value !== "aws") throw invalid();
  return value;
}

function parseInstrument(value: unknown): PriceTableInstrument {
  if (value !== "aws_compute_savings_plan") throw invalid();
  return value;
}

function parseStatus(value: unknown): PriceTableStatus {
  if (value !== "draft" && value !== "active" && value !== "superseded" && value !== "blocked") {
    throw invalid();
  }
  return value;
}

function parseLimit(value: unknown): number {
  if (value === undefined) return 50;
  if (typeof value !== "string" || !/^(?:[1-9]|[1-9][0-9]|100)$/u.test(value)) throw invalid();
  return Number.parseInt(value, 10);
}

function term(value: unknown): 12 | 36 {
  if (value !== 12 && value !== 36) throw invalid();
  return value;
}

function payment(value: unknown): PriceTablePaymentOption {
  if (value !== "no_upfront" && value !== "partial_upfront" && value !== "all_upfront") {
    throw invalid();
  }
  return value;
}

function coverage(value: unknown): Record<string, unknown> {
  const object = closedRecord(value);
  const encoded = JSON.stringify(object);
  if (
    encoded.length > 65_536 ||
    /credentials?|password|secret|token|raw_(?:file|bytes|row|rows)/iu.test(encoded)
  ) {
    throw invalid();
  }
  return object;
}

function objectKey(value: unknown): string {
  if (typeof value !== "string") throw invalid();
  const trimmed = value.trim();
  if (
    trimmed !== value ||
    !OBJECT_KEY_PATTERN.test(trimmed) ||
    trimmed.includes("..") ||
    trimmed.includes("//") ||
    trimmed.includes("\\")
  ) {
    throw invalid();
  }
  return trimmed;
}

function nullableDate(value: unknown): string | null {
  if (value === null) return null;
  return dateValue(value);
}

function dateValue(value: unknown): string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) throw invalid();
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw invalid();
  }
  return value;
}

function cleanText(value: unknown, min: number, max: number): string {
  if (typeof value !== "string") throw invalid();
  const text = value.normalize("NFC").trim();
  if (text.length < min || text.length > max || hasControlCharacter(text)) throw invalid();
  return text;
}

function unsignedInteger(value: unknown): string {
  if (typeof value !== "string" || !UNSIGNED_INTEGER_PATTERN.test(value)) throw invalid();
  return value;
}

function checksum(input: Omit<PriceTableCreateInput, "checksum">): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        provider: input.provider,
        instrument: input.instrument,
        version_label: input.versionLabel,
        effective_from: input.effectiveFrom,
        effective_to: input.effectiveTo,
        source_uri: input.sourceUri,
        items: input.items.map((item) => ({
          sku: item.sku,
          region: item.region,
          term_months: item.termMonths,
          payment_option: item.paymentOption,
          hourly_rate_cents: item.hourlyRateCents,
          upfront_cents: item.upfrontCents,
          coverage_rules: item.coverageRules,
        })),
      }),
    )
    .digest("hex");
}

function closedRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}

function rejectUnknown(value: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw invalid();
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

function invalid(): AppError {
  return new AppError({
    code: "VALIDATION_ERROR",
    message: "Request is invalid.",
    statusCode: 400,
    details: [],
  });
}
