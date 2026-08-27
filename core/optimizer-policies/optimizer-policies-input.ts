import { AppError } from "../shared/errors.js";
import type {
  OptimizerPolicyCreateInput,
  OptimizerPolicyInstrument,
  OptimizerPolicyListInput,
  OptimizerPolicyObjective,
  OptimizerPolicyPatchInput,
  OptimizerPolicyStatus,
} from "./optimizer-policies-types.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const UNSIGNED_BIGINT_PATTERN = /^(?:0|[1-9][0-9]{0,18})$/u;
const UTILIZATION_GAP_PATTERN = /^(?:100(?:\.0{1,2})?|[0-9]{1,2}(?:\.[0-9]{1,2})?)$/u;

const CREATE_FIELDS = new Set([
  "name",
  "objective",
  "max_downside_loss_cents",
  "min_expected_savings_cents",
  "max_utilization_gap_pct",
  "approval_threshold_cents",
  "allowed_instruments",
  "config",
]);
const PATCH_FIELDS = new Set([...CREATE_FIELDS, "status"]);

export function parseOptimizerPolicyCreateBody(body: unknown): OptimizerPolicyCreateInput {
  const object = closedRecord(body);
  rejectUnknown(object, CREATE_FIELDS);
  requireFields(object, CREATE_FIELDS);
  return Object.freeze({
    name: cleanText(object.name, 1, 200),
    objective: objective(object.objective),
    maxDownsideLossCents: unsignedBigint(object.max_downside_loss_cents),
    minExpectedSavingsCents: unsignedBigint(object.min_expected_savings_cents),
    maxUtilizationGapPct: utilizationGap(object.max_utilization_gap_pct),
    approvalThresholdCents: unsignedBigint(object.approval_threshold_cents),
    allowedInstruments: allowedInstruments(object.allowed_instruments),
    config: configObject(object.config),
  });
}

export function parseOptimizerPolicyPatchBody(body: unknown): OptimizerPolicyPatchInput {
  const object = closedRecord(body);
  rejectUnknown(object, PATCH_FIELDS);
  if (Object.keys(object).length === 0) throw invalid();
  return Object.freeze({
    ...(object.name === undefined ? {} : { name: cleanText(object.name, 1, 200) }),
    ...(object.objective === undefined ? {} : { objective: objective(object.objective) }),
    ...(object.max_downside_loss_cents === undefined
      ? {}
      : { maxDownsideLossCents: unsignedBigint(object.max_downside_loss_cents) }),
    ...(object.min_expected_savings_cents === undefined
      ? {}
      : { minExpectedSavingsCents: unsignedBigint(object.min_expected_savings_cents) }),
    ...(object.max_utilization_gap_pct === undefined
      ? {}
      : { maxUtilizationGapPct: utilizationGap(object.max_utilization_gap_pct) }),
    ...(object.approval_threshold_cents === undefined
      ? {}
      : { approvalThresholdCents: unsignedBigint(object.approval_threshold_cents) }),
    ...(object.allowed_instruments === undefined
      ? {}
      : { allowedInstruments: allowedInstruments(object.allowed_instruments) }),
    ...(object.config === undefined ? {} : { config: configObject(object.config) }),
    ...(object.status === undefined ? {} : { status: status(object.status) }),
  });
}

export function parseOptimizerPolicyListQuery(query: unknown): OptimizerPolicyListInput {
  const object = closedRecord(query);
  rejectUnknown(object, new Set(["limit", "cursor", "status"]));
  return Object.freeze({
    limit: parseLimit(object.limit),
    ...(object.status === undefined ? {} : { status: status(object.status) }),
  });
}

export function parseOptimizerPolicyId(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw invalid();
  return value;
}

function objective(value: unknown): OptimizerPolicyObjective {
  if (
    value !== "maximize_expected_savings" &&
    value !== "minimize_downside_loss" &&
    value !== "efficient_frontier"
  ) {
    throw invalid();
  }
  return value;
}

function status(value: unknown): OptimizerPolicyStatus {
  if (value !== "draft" && value !== "active" && value !== "archived") throw invalid();
  return value;
}

function allowedInstruments(value: unknown): readonly OptimizerPolicyInstrument[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 5) throw invalid();
  const instruments = value.map(instrument);
  if (new Set(instruments).size !== instruments.length) throw invalid();
  return Object.freeze(instruments);
}

function instrument(value: unknown): OptimizerPolicyInstrument {
  if (
    value !== "aws_compute_savings_plan" &&
    value !== "aws_reserved_instance" &&
    value !== "azure_savings_plan" &&
    value !== "azure_reservation" &&
    value !== "gcp_committed_use_discount"
  ) {
    throw invalid();
  }
  return value;
}

function unsignedBigint(value: unknown): string {
  if (typeof value !== "string" || !UNSIGNED_BIGINT_PATTERN.test(value)) throw invalid();
  const parsed = BigInt(value);
  if (parsed > 9223372036854775807n) throw invalid();
  return parsed.toString();
}

function utilizationGap(value: unknown): string {
  if (typeof value !== "string" || !UTILIZATION_GAP_PATTERN.test(value)) throw invalid();
  return Number(value).toFixed(2);
}

function configObject(value: unknown): Record<string, unknown> {
  const object = closedRecord(value);
  const encoded = JSON.stringify(object);
  if (
    encoded.length > 65_536 ||
    /credentials?|password|secret|token|raw_(?:file|bytes|row|rows)/iu.test(encoded)
  ) {
    throw invalid();
  }
  return Object.freeze({ ...object });
}

function parseLimit(value: unknown): number {
  if (value === undefined) return 50;
  if (typeof value !== "string" || !/^(?:[1-9]|[1-9][0-9]|100)$/u.test(value)) throw invalid();
  return Number.parseInt(value, 10);
}

function cleanText(value: unknown, min: number, max: number): string {
  if (typeof value !== "string") throw invalid();
  const text = value.normalize("NFC").trim();
  if (text.length < min || text.length > max || hasControlCharacter(text)) throw invalid();
  return text;
}

function closedRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}

function rejectUnknown(value: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw invalid();
}

function requireFields(value: Record<string, unknown>, required: ReadonlySet<string>): void {
  for (const key of required) if (value[key] === undefined) throw invalid();
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
