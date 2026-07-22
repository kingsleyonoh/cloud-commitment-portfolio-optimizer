CREATE TABLE price_table_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  provider TEXT NOT NULL,
  instrument TEXT NOT NULL,
  version_label TEXT NOT NULL,
  effective_from DATE NOT NULL,
  effective_to DATE DEFAULT NULL,
  source_uri TEXT NOT NULL,
  status TEXT NOT NULL,
  checksum TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT price_table_versions_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CONSTRAINT price_table_versions_provider_check CHECK (
    provider IN ('aws', 'azure', 'gcp')
  ),
  CONSTRAINT price_table_versions_instrument_check CHECK (
    instrument IN (
      'aws_compute_savings_plan',
      'aws_reserved_instance',
      'azure_savings_plan',
      'azure_reservation',
      'gcp_committed_use_discount'
    )
  ),
  CONSTRAINT price_table_versions_provider_instrument_check CHECK (
    (provider = 'aws' AND instrument IN (
      'aws_compute_savings_plan', 'aws_reserved_instance'
    ))
    OR (provider = 'azure' AND instrument IN (
      'azure_savings_plan', 'azure_reservation'
    ))
    OR (provider = 'gcp' AND instrument = 'gcp_committed_use_discount')
  ),
  CONSTRAINT price_table_versions_version_label_canonical_check CHECK (
    version_label = btrim(version_label)
    AND version_label <> ''
    AND length(version_label) <= 128
    AND version_label !~ '[[:cntrl:]]'
  ),
  CONSTRAINT price_table_versions_effective_period_check CHECK (
    effective_to IS NULL OR effective_to >= effective_from
  ),
  CONSTRAINT price_table_versions_source_uri_canonical_check CHECK (
    source_uri = btrim(source_uri)
    AND source_uri <> ''
    AND length(source_uri) <= 2048
    AND source_uri !~ '[[:cntrl:]]'
  ),
  CONSTRAINT price_table_versions_status_check CHECK (
    status IN ('draft', 'active', 'superseded', 'blocked')
  ),
  CONSTRAINT price_table_versions_checksum_shape_check CHECK (
    checksum ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT price_table_versions_timestamps_ordered_check CHECK (
    updated_at >= created_at
  ),
  CONSTRAINT price_table_versions_tenant_version_label_key
    UNIQUE (tenant_id, provider, instrument, version_label),
  CONSTRAINT price_table_versions_tenant_checksum_key
    UNIQUE (tenant_id, provider, instrument, checksum)
);

CREATE INDEX price_table_versions_tenant_lookup_idx
ON price_table_versions (tenant_id, provider, instrument, status, effective_from);

CREATE FUNCTION enforce_price_table_version_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'price table versions must be created as draft'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'price table versions cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF ROW(
    NEW.id,
    NEW.tenant_id,
    NEW.provider,
    NEW.instrument,
    NEW.version_label,
    NEW.effective_from,
    NEW.effective_to,
    NEW.source_uri,
    NEW.checksum,
    NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.id,
    OLD.tenant_id,
    OLD.provider,
    OLD.instrument,
    OLD.version_label,
    OLD.effective_from,
    OLD.effective_to,
    OLD.source_uri,
    OLD.checksum,
    OLD.created_at
  ) THEN
    RAISE EXCEPTION 'price table version identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NOT (
    (OLD.status = 'draft' AND NEW.status IN ('active', 'blocked'))
    OR (OLD.status = 'active' AND NEW.status IN ('superseded', 'blocked'))
  ) THEN
    RAISE EXCEPTION 'invalid price table version status transition'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.status = 'active' THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(NEW.tenant_id::text || ':' || NEW.provider || ':' || NEW.instrument, 0)
    );
    IF EXISTS (
      SELECT 1
      FROM price_table_versions existing
      WHERE existing.tenant_id = NEW.tenant_id
        AND existing.provider = NEW.provider
        AND existing.instrument = NEW.instrument
        AND existing.status = 'active'
        AND existing.id <> NEW.id
        AND existing.effective_from <= COALESCE(NEW.effective_to, 'infinity'::date)
        AND NEW.effective_from <= COALESCE(existing.effective_to, 'infinity'::date)
    ) THEN
      RAISE EXCEPTION 'active price table effective periods overlap'
        USING ERRCODE = '23P01';
    END IF;
  END IF;

  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER price_table_versions_enforce_lifecycle
BEFORE INSERT OR UPDATE OR DELETE ON price_table_versions
FOR EACH ROW
EXECUTE FUNCTION enforce_price_table_version_lifecycle();
