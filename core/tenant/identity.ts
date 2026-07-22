import {
  normalizeAddress,
  normalizeEmail,
  normalizeNullableText,
  normalizeRegistration,
  normalizeSupportUrl,
  normalizeText,
} from "./identity-fields.js";
import { isCanonicalTimezone, isSupportedCurrency } from "./tenant-catalogues.js";
import { TenantInputValidationError } from "./tenant-input-error.js";
import type { NormalizedTenantInput, TenantInput } from "./identity-types.js";

export { TenantInputValidationError } from "./tenant-input-error.js";
export type { NormalizedTenantInput, TenantAddress, TenantInput } from "./identity-types.js";

const BIGINT_MAX = 9_223_372_036_854_775_807n;
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)$/u;

export function normalizeTenantInput(input: TenantInput): NormalizedTenantInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid("request");
  const name = normalizeText(input.name, "Tenant name", 200);
  const legalName = derivedName(input.legalName, name, "Tenant legal name");
  const fullLegalName = derivedName(input.fullLegalName, legalName, "Tenant full legal name");
  const displayName = derivedName(input.displayName, name, "Tenant display name");
  return {
    name,
    legalName,
    fullLegalName,
    displayName,
    address: normalizeAddress(input.address),
    registration: normalizeRegistration(input.registration),
    contactEmail: normalizeEmail(input.contactEmail, "contact_email"),
    contactPhone: normalizeNullableText(input.contactPhone, "contact_phone", 64),
    supportUrl: normalizeSupportUrl(input.supportUrl),
    financeOwnerEmail: normalizeEmail(input.financeOwnerEmail, "finance_owner_email"),
    wordmark: normalizeNullableText(input.wordmark, "wordmark", 256),
    defaultCurrency: normalizeCurrency(input.defaultCurrency),
    timezone: normalizeTimezone(input.timezone),
    riskBudgetCents: normalizeRiskBudget(input.riskBudgetCents),
  };
}

function derivedName(value: unknown, fallback: string, field: string): string {
  return value === undefined ? fallback : normalizeText(value, field, 200);
}

function normalizeCurrency(value: unknown): string {
  if (value === undefined) return "USD";
  const currency = normalizeText(value, "default_currency", 3).toUpperCase();
  if (!/^[A-Z]{3}$/u.test(currency) || !isSupportedCurrency(currency)) {
    invalid("default_currency");
  }
  return currency;
}

function normalizeTimezone(value: unknown): string {
  if (value === undefined) return "UTC";
  const timezone = normalizeText(value, "timezone", 64);
  if (!isCanonicalTimezone(timezone)) invalid("timezone");
  return timezone;
}

function normalizeRiskBudget(value: unknown): string {
  if (value === undefined) return "0";
  if (typeof value !== "string" || !DECIMAL_PATTERN.test(value)) invalid("risk_budget_cents");
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    invalid("risk_budget_cents");
  }
  if (parsed > BIGINT_MAX) invalid("risk_budget_cents");
  return value;
}

function invalid(field: string): never {
  throw new TenantInputValidationError(`${field} is invalid.`);
}
