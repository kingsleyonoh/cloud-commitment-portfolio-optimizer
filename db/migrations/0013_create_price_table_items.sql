CREATE UNIQUE INDEX price_table_versions_tenant_identity_key
ON price_table_versions (tenant_id, id, provider, instrument);

CREATE TABLE price_table_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  price_table_version_id UUID NOT NULL,
  provider TEXT NOT NULL,
  instrument TEXT NOT NULL,
  sku TEXT NOT NULL,
  region TEXT NOT NULL,
  term_months INT NOT NULL,
  payment_option TEXT NOT NULL,
  hourly_rate_cents BIGINT NOT NULL,
  upfront_cents BIGINT NOT NULL DEFAULT 0,
  coverage_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT price_table_items_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CONSTRAINT price_table_items_tenant_version_fkey
    FOREIGN KEY (tenant_id, price_table_version_id, provider, instrument)
    REFERENCES price_table_versions(tenant_id, id, provider, instrument)
    ON DELETE RESTRICT,
  CONSTRAINT price_table_items_provider_check CHECK (
    provider IN ('aws', 'azure', 'gcp')
  ),
  CONSTRAINT price_table_items_instrument_check CHECK (
    instrument IN (
      'aws_compute_savings_plan',
      'aws_reserved_instance',
      'azure_savings_plan',
      'azure_reservation',
      'gcp_committed_use_discount'
    )
  ),
  CONSTRAINT price_table_items_provider_instrument_check CHECK (
    (provider = 'aws' AND instrument IN (
      'aws_compute_savings_plan', 'aws_reserved_instance'
    ))
    OR (provider = 'azure' AND instrument IN (
      'azure_savings_plan', 'azure_reservation'
    ))
    OR (provider = 'gcp' AND instrument = 'gcp_committed_use_discount')
  ),
  CONSTRAINT price_table_items_sku_canonical_check CHECK (
    sku = btrim(sku)
    AND sku <> ''
    AND length(sku) <= 512
    AND sku !~ '[[:cntrl:]]'
  ),
  CONSTRAINT price_table_items_region_canonical_check CHECK (
    region = btrim(region)
    AND region <> ''
    AND length(region) <= 128
    AND region !~ '[[:cntrl:]]'
  ),
  CONSTRAINT price_table_items_term_months_positive_check CHECK (
    term_months > 0
  ),
  CONSTRAINT price_table_items_payment_option_check CHECK (
    payment_option IN ('no_upfront', 'partial_upfront', 'all_upfront', 'monthly')
  ),
  CONSTRAINT price_table_items_economics_nonnegative_check CHECK (
    hourly_rate_cents >= 0 AND upfront_cents >= 0
  ),
  CONSTRAINT price_table_items_coverage_rules_object_check CHECK (
    jsonb_typeof(coverage_rules) = 'object'
    AND octet_length(coverage_rules::text) <= 65536
    AND NOT coverage_rules ?| ARRAY[
      'credentials', 'credential', 'password', 'secret', 'token',
      'raw_file', 'raw_bytes', 'raw_row', 'raw_rows'
    ]
  ),
  CONSTRAINT price_table_items_tenant_dimensions_key UNIQUE (
    tenant_id,
    price_table_version_id,
    provider,
    instrument,
    sku,
    region,
    term_months,
    payment_option
  )
);

CREATE INDEX price_table_items_tenant_version_sku_region_idx
ON price_table_items (tenant_id, price_table_version_id, sku, region);

CREATE INDEX price_table_items_tenant_dimensions_idx
ON price_table_items (tenant_id, provider, instrument, term_months);

CREATE FUNCTION enforce_price_table_item_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status TEXT;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'price table items are immutable'
      USING ERRCODE = '55000';
  END IF;

  SELECT status
  INTO parent_status
  FROM price_table_versions
  WHERE tenant_id = NEW.tenant_id
    AND id = NEW.price_table_version_id
    AND provider = NEW.provider
    AND instrument = NEW.instrument
  FOR SHARE;

  IF FOUND AND parent_status <> 'draft' THEN
    RAISE EXCEPTION 'price table items require a draft version'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER price_table_items_enforce_snapshot
BEFORE INSERT OR UPDATE OR DELETE ON price_table_items
FOR EACH ROW
EXECUTE FUNCTION enforce_price_table_item_snapshot();
