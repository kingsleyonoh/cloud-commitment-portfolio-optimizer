CREATE FUNCTION optimizer_text_array_is_canonical(scope_values TEXT[], max_items INT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT cardinality(scope_values) BETWEEN 1 AND max_items
    AND array_position(scope_values, NULL) IS NULL
    AND cardinality(scope_values) = (
      SELECT count(DISTINCT value)::INT FROM unnest(scope_values) AS values_list(value)
    )
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(scope_values) AS values_list(value)
      WHERE value <> btrim(value)
        OR value = ''
        OR length(value) > 128
        OR value ~ '[[:cntrl:]]'
    );
$$;

CREATE TABLE optimizer_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  objective TEXT NOT NULL,
  max_downside_loss_cents BIGINT NOT NULL,
  min_expected_savings_cents BIGINT NOT NULL DEFAULT 0,
  max_utilization_gap_pct NUMERIC(5,2) NOT NULL DEFAULT 15.00,
  approval_threshold_cents BIGINT NOT NULL DEFAULT 0,
  allowed_instruments TEXT[] NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT optimizer_policies_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CONSTRAINT optimizer_policies_name_check CHECK (
    name = btrim(name)
    AND name <> ''
    AND length(name) <= 200
    AND name !~ '[[:cntrl:]]'
  ),
  CONSTRAINT optimizer_policies_objective_check CHECK (
    objective IN ('maximize_expected_savings', 'minimize_downside_loss', 'efficient_frontier')
  ),
  CONSTRAINT optimizer_policies_cents_check CHECK (
    max_downside_loss_cents >= 0
    AND min_expected_savings_cents >= 0
    AND approval_threshold_cents >= 0
  ),
  CONSTRAINT optimizer_policies_utilization_gap_check CHECK (
    max_utilization_gap_pct >= 0.00 AND max_utilization_gap_pct <= 100.00
  ),
  CONSTRAINT optimizer_policies_allowed_instruments_check CHECK (
    optimizer_text_array_is_canonical(allowed_instruments, 5)
    AND allowed_instruments <@ ARRAY[
      'aws_compute_savings_plan',
      'aws_reserved_instance',
      'azure_savings_plan',
      'azure_reservation',
      'gcp_committed_use_discount'
    ]::TEXT[]
  ),
  CONSTRAINT optimizer_policies_config_object_check CHECK (
    jsonb_typeof(config) = 'object'
    AND octet_length(config::text) <= 65536
    AND NOT config ?| ARRAY[
      'credentials', 'credential', 'password', 'secret', 'token',
      'raw_file', 'raw_bytes', 'raw_row', 'raw_rows'
    ]
  ),
  CONSTRAINT optimizer_policies_status_check CHECK (
    status IN ('draft', 'active', 'archived')
  ),
  CONSTRAINT optimizer_policies_timestamps_ordered_check CHECK (
    updated_at >= created_at
  ),
  CONSTRAINT optimizer_policies_name_key UNIQUE (tenant_id, name)
);

CREATE UNIQUE INDEX optimizer_policies_tenant_identity_key
ON optimizer_policies (tenant_id, id);

CREATE INDEX optimizer_policies_tenant_status_idx
ON optimizer_policies (tenant_id, status);

CREATE FUNCTION enforce_optimizer_policy_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'optimizer policies must be created as draft'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'optimizer policies cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF ROW(NEW.id, NEW.tenant_id, NEW.created_at) IS DISTINCT FROM
     ROW(OLD.id, OLD.tenant_id, OLD.created_at) THEN
    RAISE EXCEPTION 'optimizer policy ownership is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status = 'archived' THEN
    RAISE EXCEPTION 'optimizer policy is archived'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status = 'active' THEN
    IF ROW(
      NEW.name, NEW.objective, NEW.max_downside_loss_cents,
      NEW.min_expected_savings_cents, NEW.max_utilization_gap_pct,
      NEW.approval_threshold_cents, NEW.allowed_instruments, NEW.config
    ) IS DISTINCT FROM ROW(
      OLD.name, OLD.objective, OLD.max_downside_loss_cents,
      OLD.min_expected_savings_cents, OLD.max_utilization_gap_pct,
      OLD.approval_threshold_cents, OLD.allowed_instruments, OLD.config
    ) THEN
      RAISE EXCEPTION 'active optimizer policy is frozen'
        USING ERRCODE = '55000';
    END IF;
    IF NEW.status <> 'archived' THEN
      RAISE EXCEPTION 'invalid optimizer policy status transition'
        USING ERRCODE = '55000';
    END IF;
  ELSIF OLD.status = 'draft' AND NEW.status NOT IN ('draft', 'active', 'archived') THEN
    RAISE EXCEPTION 'invalid optimizer policy status transition'
      USING ERRCODE = '55000';
  END IF;

  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER optimizer_policies_enforce_lifecycle
BEFORE INSERT OR UPDATE OR DELETE ON optimizer_policies
FOR EACH ROW
EXECUTE FUNCTION enforce_optimizer_policy_lifecycle();
