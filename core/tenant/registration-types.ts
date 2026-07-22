export interface TenantRegistrationAddressBody {
  line1?: string;
  line2?: string;
  locality?: string;
  region?: string;
  postal_code?: string;
  country_code?: string;
}

export interface TenantRegistrationBody {
  name: string;
  legal_name?: string;
  full_legal_name?: string;
  display_name?: string;
  address?: TenantRegistrationAddressBody;
  registration?: Readonly<Record<string, string>>;
  contact_email?: string;
  contact_phone?: string;
  support_url?: string;
  finance_owner_email?: string;
  wordmark?: string;
  default_currency?: string;
  timezone?: string;
  risk_budget_cents?: string;
}

export interface TenantProfile {
  id: string;
  name: string;
  legal_name: string;
  full_legal_name: string;
  display_name: string;
  address: Readonly<Record<string, string>>;
  registration: Readonly<Record<string, string>>;
  contact_email: string | null;
  contact_phone: string | null;
  support_url: string | null;
  finance_owner_email: string | null;
  wordmark: string | null;
  default_currency: string;
  timezone: string;
  risk_budget_cents: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface TenantRegistrationCreated {
  tenant: TenantProfile;
  apiKey: string;
}
