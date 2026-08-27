CREATE UNIQUE INDEX import_batches_tenant_id_id_key
ON import_batches (tenant_id, id);

CREATE TABLE usage_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  import_batch_id UUID NOT NULL,
  cloud_account_id UUID NOT NULL,
  provider TEXT NOT NULL,
  service_code TEXT NOT NULL,
  sku TEXT NOT NULL,
  region TEXT NOT NULL,
  usage_start TIMESTAMPTZ NOT NULL,
  usage_end TIMESTAMPTZ NOT NULL,
  usage_quantity NUMERIC(20,8) NOT NULL,
  usage_unit TEXT NOT NULL,
  on_demand_cost_cents BIGINT NOT NULL,
  realized_cost_cents BIGINT NOT NULL,
  commitment_applied_cents BIGINT NOT NULL DEFAULT 0,
  tags JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT usage_line_items_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CONSTRAINT usage_line_items_tenant_import_batch_fkey
    FOREIGN KEY (tenant_id, import_batch_id)
    REFERENCES import_batches(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT usage_line_items_tenant_cloud_account_fkey
    FOREIGN KEY (tenant_id, cloud_account_id)
    REFERENCES cloud_accounts(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT usage_line_items_provider_check CHECK (
    provider IN ('aws', 'azure', 'gcp')
  ),
  CONSTRAINT usage_line_items_service_code_canonical_check CHECK (
    service_code = btrim(service_code)
    AND service_code <> ''
    AND service_code !~ '[[:cntrl:]]'
  ),
  CONSTRAINT usage_line_items_sku_canonical_check CHECK (
    sku = btrim(sku)
    AND sku <> ''
    AND sku !~ '[[:cntrl:]]'
  ),
  CONSTRAINT usage_line_items_region_canonical_check CHECK (
    region = btrim(region)
    AND region <> ''
    AND region !~ '[[:cntrl:]]'
  ),
  CONSTRAINT usage_line_items_usage_unit_canonical_check CHECK (
    usage_unit = btrim(usage_unit)
    AND usage_unit <> ''
    AND usage_unit !~ '[[:cntrl:]]'
  ),
  CONSTRAINT usage_line_items_usage_period_check CHECK (
    usage_end > usage_start
  ),
  CONSTRAINT usage_line_items_usage_quantity_nonnegative_check CHECK (
    usage_quantity >= 0
  ),
  CONSTRAINT usage_line_items_costs_nonnegative_check CHECK (
    on_demand_cost_cents >= 0
    AND realized_cost_cents >= 0
    AND commitment_applied_cents >= 0
  ),
  CONSTRAINT usage_line_items_commitment_allocation_check CHECK (
    on_demand_cost_cents < 0
    OR commitment_applied_cents <= on_demand_cost_cents
  ),
  CONSTRAINT usage_line_items_tags_object_check CHECK (
    jsonb_typeof(tags) = 'object'
  )
);

CREATE INDEX usage_line_items_tenant_usage_dimensions_idx
ON usage_line_items (tenant_id, provider, service_code, region, usage_start);

CREATE INDEX usage_line_items_tenant_account_usage_start_idx
ON usage_line_items (tenant_id, cloud_account_id, usage_start);

CREATE INDEX usage_line_items_tenant_import_batch_idx
ON usage_line_items (tenant_id, import_batch_id);

CREATE FUNCTION reject_usage_line_item_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'usage_line_items are immutable'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER usage_line_items_reject_mutation
BEFORE UPDATE OR DELETE ON usage_line_items
FOR EACH ROW
EXECUTE FUNCTION reject_usage_line_item_mutation();
