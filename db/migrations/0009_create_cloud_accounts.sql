CREATE TABLE cloud_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  provider TEXT NOT NULL,
  external_ref TEXT NOT NULL,
  display_name TEXT NOT NULL,
  currency TEXT NOT NULL,
  tags JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cloud_accounts_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CONSTRAINT cloud_accounts_provider_check CHECK (
    provider IN ('aws', 'azure', 'gcp')
  ),
  CONSTRAINT cloud_accounts_external_ref_canonical_check CHECK (
    external_ref = btrim(external_ref)
    AND external_ref = lower(external_ref)
    AND external_ref <> ''
  ),
  CONSTRAINT cloud_accounts_display_name_trimmed_check CHECK (
    display_name = btrim(display_name) AND display_name <> ''
  ),
  CONSTRAINT cloud_accounts_currency_shape_check CHECK (
    currency ~ '^[A-Z]{3}$'
  ),
  CONSTRAINT cloud_accounts_tags_object_check CHECK (
    jsonb_typeof(tags) = 'object'
  ),
  CONSTRAINT cloud_accounts_timestamps_ordered_check CHECK (
    updated_at >= created_at
  ),
  CONSTRAINT cloud_accounts_tenant_provider_external_ref_key
    UNIQUE (tenant_id, provider, external_ref)
);

CREATE INDEX cloud_accounts_tenant_provider_active_idx
ON cloud_accounts (tenant_id, provider, is_active);

CREATE FUNCTION set_cloud_accounts_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER cloud_accounts_set_updated_at
BEFORE UPDATE ON cloud_accounts
FOR EACH ROW
EXECUTE FUNCTION set_cloud_accounts_updated_at();
