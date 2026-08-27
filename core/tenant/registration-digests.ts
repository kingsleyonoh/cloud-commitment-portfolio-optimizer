import { createHash } from "node:crypto";
import {
  normalizeTenantInput,
  type NormalizedTenantInput,
  type TenantAddress,
  type TenantInput,
} from "./identity.js";

export const REGISTRATION_CANONICAL_VERSION = "tenant-registration:v1";

export interface PreparedRegistrationRequest {
  tenant: NormalizedTenantInput;
  idempotencyKeyHash: Buffer;
  requestSha256: Buffer;
  canonicalRequest: string;
}

export class RegistrationDigestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistrationDigestError";
  }
}

export function validateIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || hasControlCharacters(value)) invalidKey();
  const normalized = value.trim();
  if (normalized.length < 16 || normalized.length > 128 || !/^[\x21-\x7e]+$/u.test(normalized)) {
    invalidKey();
  }
  return normalized;
}

export function prepareRegistrationRequest(
  idempotencyKey: unknown,
  input: TenantInput,
): PreparedRegistrationRequest {
  const normalizedKey = validateIdempotencyKey(idempotencyKey);
  const tenant = normalizeTenantInput(input);
  const canonicalRequest = canonicalRegistrationRequest(tenant);
  return {
    tenant,
    idempotencyKeyHash: sha256(normalizedKey),
    requestSha256: sha256(canonicalRequest),
    canonicalRequest,
  };
}

export function canonicalRegistrationRequest(tenant: NormalizedTenantInput): string {
  const body = {
    name: tenant.name,
    legal_name: tenant.legalName,
    full_legal_name: tenant.fullLegalName,
    display_name: tenant.displayName,
    address: canonicalAddress(tenant.address),
    registration: sortedRegistration(tenant.registration),
    contact_email: tenant.contactEmail,
    contact_phone: tenant.contactPhone,
    support_url: tenant.supportUrl,
    finance_owner_email: tenant.financeOwnerEmail,
    wordmark: tenant.wordmark,
    default_currency: tenant.defaultCurrency,
    timezone: tenant.timezone,
    risk_budget_cents: tenant.riskBudgetCents,
  };
  return `${REGISTRATION_CANONICAL_VERSION}\n${JSON.stringify(body)}`;
}

function canonicalAddress(address: Readonly<TenantAddress>): Record<string, string | null> {
  return {
    line1: address.line1 ?? null,
    line2: address.line2 ?? null,
    locality: address.locality ?? null,
    region: address.region ?? null,
    postal_code: address.postalCode ?? null,
    country_code: address.countryCode ?? null,
  };
}

function sortedRegistration(input: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
  );
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
  });
}

function invalidKey(): never {
  throw new RegistrationDigestError("Idempotency-Key is invalid.");
}
