import { isSupportedCountryCode } from "./tenant-catalogues.js";
import type { TenantAddress } from "./identity-types.js";
import { TenantInputValidationError } from "./tenant-input-error.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/u;

export function normalizeText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string") invalid(field);
  const normalized = value.normalize("NFC").trim();
  if (!normalized) throw new TenantInputValidationError(`${field} is required.`);
  if (hasControlCharacters(value) || codePointLength(normalized) > maximum) invalid(field);
  return normalized;
}

export function normalizeNullableText(
  value: unknown,
  field: string,
  maximum: number,
): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || hasControlCharacters(value)) invalid(field);
  const normalized = value.normalize("NFC").trim();
  if (!normalized) return null;
  if (codePointLength(normalized) > maximum) invalid(field);
  return normalized;
}

export function normalizeEmail(value: unknown, field: string): string | null {
  const normalized = normalizeNullableText(value, field, 254);
  if (normalized === null) return null;
  const separator = normalized.lastIndexOf("@");
  if (separator <= 0 || !EMAIL_PATTERN.test(normalized)) invalid(field);
  const local = normalized.slice(0, separator);
  const domain = normalized.slice(separator + 1).toLowerCase();
  if (local.length > 64 || !validDomain(domain)) invalid(field);
  return `${local}@${domain}`;
}

export function normalizeSupportUrl(value: unknown): string | null {
  const normalized = normalizeNullableText(value, "support_url", 2048);
  if (normalized === null) return null;
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    invalid("support_url");
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password
  ) {
    invalid("support_url");
  }
  return normalized;
}

export function normalizeAddress(value: unknown): Readonly<TenantAddress> {
  if (value === undefined) return {};
  if (!isRecord(value)) invalid("address");
  const allowed = new Set(["line1", "line2", "locality", "region", "postalCode", "countryCode"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) invalid("address");
  const output: TenantAddress = {};
  assignAddress(output, "line1", value.line1, 200);
  assignAddress(output, "line2", value.line2, 200);
  assignAddress(output, "locality", value.locality, 100);
  assignAddress(output, "region", value.region, 100);
  assignAddress(output, "postalCode", value.postalCode, 32);
  if (value.countryCode !== undefined) {
    const country = normalizeText(value.countryCode, "address.country_code", 2).toUpperCase();
    if (!/^[A-Z]{2}$/u.test(country) || !isSupportedCountryCode(country)) {
      invalid("address.country_code");
    }
    output.countryCode = country;
  }
  if (
    Object.keys(output).length > 0 &&
    (!output.line1 || !output.locality || !output.countryCode)
  ) {
    invalid("address");
  }
  return output;
}

export function normalizeRegistration(value: unknown): Readonly<Record<string, string>> {
  if (value === undefined) return {};
  if (!isRecord(value) || Object.keys(value).length > 32) invalid("registration");
  const normalized = new Map<string, string>();
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = normalizeText(rawKey, "registration key", 64).toUpperCase();
    if (normalized.has(key)) invalid("registration");
    normalized.set(key, normalizeText(rawValue, "registration value", 256));
  }
  return Object.fromEntries([...normalized].sort(([left], [right]) => left.localeCompare(right)));
}

function assignAddress(
  output: TenantAddress,
  key: keyof TenantAddress,
  value: unknown,
  maximum: number,
): void {
  if (value === undefined) return;
  const normalized = normalizeNullableText(value, `address.${key}`, maximum);
  if (normalized !== null) output[key] = normalized;
}

function validDomain(domain: string): boolean {
  if (domain.length > 253 || !domain.includes(".")) return false;
  return domain.split(".").every((label) => /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)$/u.test(label));
}

function codePointLength(value: string): number {
  return [...value].length;
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalid(field: string): never {
  throw new TenantInputValidationError(`${field} is invalid.`);
}
