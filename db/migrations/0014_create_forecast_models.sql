CREATE FUNCTION forecast_scope_is_canonical(scope_values TEXT[], max_items INT)
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

CREATE TABLE forecast_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  provider_scope TEXT[] NOT NULL,
  service_scope TEXT[] NOT NULL,
  horizon_months INT NOT NULL,
  method TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by_user_id UUID DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT forecast_models_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CONSTRAINT forecast_models_created_by_tenant_fkey
    FOREIGN KEY (tenant_id, created_by_user_id)
    REFERENCES users(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT forecast_models_name_canonical_check CHECK (
    name = btrim(name)
    AND name <> ''
    AND length(name) <= 200
    AND name !~ '[[:cntrl:]]'
  ),
  CONSTRAINT forecast_models_provider_scope_check CHECK (
    forecast_scope_is_canonical(provider_scope, 3)
    AND provider_scope <@ ARRAY['aws', 'azure', 'gcp']::TEXT[]
  ),
  CONSTRAINT forecast_models_service_scope_check CHECK (
    forecast_scope_is_canonical(service_scope, 100)
    AND octet_length(array_to_string(service_scope, ',')) <= 8192
  ),
  CONSTRAINT forecast_models_horizon_months_check CHECK (
    horizon_months IN (1, 3, 6, 12, 24, 36)
  ),
  CONSTRAINT forecast_models_method_check CHECK (
    method IN (
      'seasonal_naive',
      'exponential_smoothing',
      'quantile_bootstrap',
      'scenario_override'
    )
  ),
  CONSTRAINT forecast_models_config_object_check CHECK (
    jsonb_typeof(config) = 'object'
    AND octet_length(config::text) <= 65536
    AND NOT config ?| ARRAY[
      'credentials', 'credential', 'password', 'secret', 'token',
      'raw_file', 'raw_bytes', 'raw_row', 'raw_rows'
    ]
  ),
  CONSTRAINT forecast_models_status_check CHECK (
    status IN ('draft', 'active', 'archived')
  ),
  CONSTRAINT forecast_models_timestamps_ordered_check CHECK (
    updated_at >= created_at
  ),
  CONSTRAINT forecast_models_tenant_name_key UNIQUE (tenant_id, name)
);

CREATE UNIQUE INDEX forecast_models_tenant_identity_key
ON forecast_models (tenant_id, id);

CREATE INDEX forecast_models_tenant_status_created_idx
ON forecast_models (tenant_id, status, created_at);

CREATE FUNCTION enforce_forecast_model_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'forecast models must be created as draft'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'forecast models cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF ROW(NEW.id, NEW.tenant_id, NEW.created_by_user_id, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.tenant_id, OLD.created_by_user_id, OLD.created_at) THEN
    RAISE EXCEPTION 'forecast model ownership is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status = 'archived' THEN
    RAISE EXCEPTION 'forecast model is archived'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status = 'active' THEN
    IF ROW(
      NEW.name, NEW.provider_scope, NEW.service_scope, NEW.horizon_months,
      NEW.method, NEW.config
    ) IS DISTINCT FROM ROW(
      OLD.name, OLD.provider_scope, OLD.service_scope, OLD.horizon_months,
      OLD.method, OLD.config
    ) THEN
      RAISE EXCEPTION 'active forecast model is frozen'
        USING ERRCODE = '55000';
    END IF;
    IF NEW.status <> 'archived' THEN
      RAISE EXCEPTION 'invalid forecast model status transition'
        USING ERRCODE = '55000';
    END IF;
  ELSIF OLD.status = 'draft' AND NEW.status NOT IN ('draft', 'active', 'archived') THEN
    RAISE EXCEPTION 'invalid forecast model status transition'
      USING ERRCODE = '55000';
  END IF;

  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER forecast_models_enforce_lifecycle
BEFORE INSERT OR UPDATE OR DELETE ON forecast_models
FOR EACH ROW
EXECUTE FUNCTION enforce_forecast_model_lifecycle();
