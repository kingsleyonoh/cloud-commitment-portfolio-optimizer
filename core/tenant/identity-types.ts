export interface TenantAddress {
  line1?: string;
  line2?: string;
  locality?: string;
  region?: string;
  postalCode?: string;
  countryCode?: string;
}

export interface TenantInput {
  name: string;
  legalName?: string;
  fullLegalName?: string;
  displayName?: string;
  address?: TenantAddress;
  registration?: Readonly<Record<string, string>>;
  contactEmail?: string;
  contactPhone?: string;
  supportUrl?: string;
  financeOwnerEmail?: string;
  wordmark?: string;
  defaultCurrency?: string;
  timezone?: string;
  riskBudgetCents?: string;
}

export interface NormalizedTenantInput {
  name: string;
  legalName: string;
  fullLegalName: string;
  displayName: string;
  address: Readonly<TenantAddress>;
  registration: Readonly<Record<string, string>>;
  contactEmail: string | null;
  contactPhone: string | null;
  supportUrl: string | null;
  financeOwnerEmail: string | null;
  wordmark: string | null;
  defaultCurrency: string;
  timezone: string;
  riskBudgetCents: string;
}
