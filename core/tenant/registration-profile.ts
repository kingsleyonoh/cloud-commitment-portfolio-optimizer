import type { TenantAddress } from "./identity.js";
import type { TenantProfile } from "./registration-types.js";

export interface RegistrationTenantRow {
  id: string;
  name: string;
  legalName: string;
  fullLegalName: string;
  displayName: string;
  address: Readonly<Record<string, string>>;
  registration: Readonly<Record<string, string>>;
  contactEmail: string | null;
  contactPhone: string | null;
  supportUrl: string | null;
  financeOwnerEmail: string | null;
  wordmark: string | null;
  defaultCurrency: string;
  timezone: string;
  riskBudgetCents: string;
  isActive: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export function databaseAddress(address: Readonly<TenantAddress>): Record<string, string> {
  const output: Record<string, string> = {};
  if (address.line1) output.line1 = address.line1;
  if (address.line2) output.line2 = address.line2;
  if (address.locality) output.locality = address.locality;
  if (address.region) output.region = address.region;
  if (address.postalCode) output.postal_code = address.postalCode;
  if (address.countryCode) output.country_code = address.countryCode;
  return output;
}

export function tenantProfile(row: RegistrationTenantRow): TenantProfile {
  return {
    id: row.id,
    name: row.name,
    legal_name: row.legalName,
    full_legal_name: row.fullLegalName,
    display_name: row.displayName,
    address: row.address,
    registration: row.registration,
    contact_email: row.contactEmail,
    contact_phone: row.contactPhone,
    support_url: row.supportUrl,
    finance_owner_email: row.financeOwnerEmail,
    wordmark: row.wordmark,
    default_currency: row.defaultCurrency,
    timezone: row.timezone,
    risk_budget_cents: row.riskBudgetCents,
    is_active: row.isActive,
    created_at: timestamp(row.createdAt),
    updated_at: timestamp(row.updatedAt),
  };
}

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
