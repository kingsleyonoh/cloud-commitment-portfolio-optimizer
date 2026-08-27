CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  legal_name TEXT NOT NULL,
  full_legal_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  address JSONB NOT NULL DEFAULT '{}'::jsonb,
  registration JSONB NOT NULL DEFAULT '{}'::jsonb,
  contact_email TEXT DEFAULT NULL,
  contact_phone TEXT DEFAULT NULL,
  support_url TEXT DEFAULT NULL,
  finance_owner_email TEXT DEFAULT NULL,
  wordmark TEXT DEFAULT NULL,
  default_currency TEXT NOT NULL DEFAULT 'USD',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  risk_budget_cents BIGINT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tenants_name_trimmed_check CHECK (name = btrim(name) AND name <> ''),
  CONSTRAINT tenants_legal_name_trimmed_check CHECK (
    legal_name = btrim(legal_name) AND legal_name <> ''
  ),
  CONSTRAINT tenants_full_legal_name_trimmed_check CHECK (
    full_legal_name = btrim(full_legal_name) AND full_legal_name <> ''
  ),
  CONSTRAINT tenants_display_name_trimmed_check CHECK (
    display_name = btrim(display_name) AND display_name <> ''
  ),
  CONSTRAINT tenants_address_object_check CHECK (jsonb_typeof(address) = 'object'),
  CONSTRAINT tenants_registration_object_check CHECK (jsonb_typeof(registration) = 'object'),
  CONSTRAINT tenants_contact_email_trimmed_check CHECK (
    contact_email IS NULL OR (contact_email = btrim(contact_email) AND contact_email <> '')
  ),
  CONSTRAINT tenants_contact_phone_trimmed_check CHECK (
    contact_phone IS NULL OR (contact_phone = btrim(contact_phone) AND contact_phone <> '')
  ),
  CONSTRAINT tenants_support_url_trimmed_check CHECK (
    support_url IS NULL OR (support_url = btrim(support_url) AND support_url <> '')
  ),
  CONSTRAINT tenants_finance_owner_email_trimmed_check CHECK (
    finance_owner_email IS NULL
    OR (finance_owner_email = btrim(finance_owner_email) AND finance_owner_email <> '')
  ),
  CONSTRAINT tenants_wordmark_trimmed_check CHECK (
    wordmark IS NULL OR (wordmark = btrim(wordmark) AND wordmark <> '')
  ),
  CONSTRAINT tenants_currency_shape_check CHECK (default_currency ~ '^[A-Z]{3}$'),
  CONSTRAINT tenants_timezone_trimmed_check CHECK (
    timezone = btrim(timezone) AND timezone <> ''
  ),
  CONSTRAINT tenants_risk_budget_nonnegative_check CHECK (risk_budget_cents >= 0),
  CONSTRAINT tenants_timestamps_ordered_check CHECK (updated_at >= created_at)
);

CREATE INDEX tenants_is_active_idx ON tenants (is_active);

CREATE FUNCTION set_tenants_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER tenants_set_updated_at
BEFORE UPDATE ON tenants
FOR EACH ROW
EXECUTE FUNCTION set_tenants_updated_at();
