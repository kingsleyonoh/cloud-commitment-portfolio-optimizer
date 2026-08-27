CREATE UNIQUE INDEX forecast_runs_tenant_id_id_key
ON forecast_runs (tenant_id, id);

CREATE TABLE scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT NULL,
  base_forecast_run_id UUID DEFAULT NULL,
  shock_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by_user_id UUID DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT scenarios_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CONSTRAINT scenarios_tenant_forecast_fkey
    FOREIGN KEY (tenant_id, base_forecast_run_id)
    REFERENCES forecast_runs(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT scenarios_created_by_tenant_fkey
    FOREIGN KEY (tenant_id, created_by_user_id)
    REFERENCES users(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT scenarios_name_check CHECK (
    name = btrim(name)
    AND name <> ''
    AND length(name) <= 200
    AND name !~ '[[:cntrl:]]'
  ),
  CONSTRAINT scenarios_description_check CHECK (
    description IS NULL
    OR (
      description = btrim(description)
      AND description <> ''
      AND length(description) <= 2000
      AND description !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT scenarios_shock_config_object_check CHECK (
    jsonb_typeof(shock_config) = 'object'
    AND octet_length(shock_config::text) <= 65536
    AND NOT shock_config ?| ARRAY[
      'credentials', 'credential', 'password', 'secret', 'token',
      'raw_file', 'raw_bytes', 'raw_row', 'raw_rows'
    ]
  ),
  CONSTRAINT scenarios_status_check CHECK (
    status IN ('draft', 'ready', 'archived')
  ),
  CONSTRAINT scenarios_timestamps_ordered_check CHECK (
    updated_at >= created_at
  ),
  CONSTRAINT scenarios_name_key UNIQUE (tenant_id, name)
);

CREATE UNIQUE INDEX scenarios_tenant_identity_key
ON scenarios (tenant_id, id);

CREATE INDEX scenarios_tenant_status_created_idx
ON scenarios (tenant_id, status, created_at);

CREATE FUNCTION enforce_scenario_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'scenarios must be created as draft'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.base_forecast_run_id IS NOT NULL THEN
      SELECT status INTO parent_status
      FROM forecast_runs
      WHERE tenant_id = NEW.tenant_id AND id = NEW.base_forecast_run_id
      FOR SHARE;

      IF FOUND AND parent_status <> 'completed' THEN
        RAISE EXCEPTION 'scenarios require a completed forecast run'
          USING ERRCODE = '55000';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'scenarios cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF ROW(
    NEW.id, NEW.tenant_id, NEW.base_forecast_run_id, NEW.created_by_user_id, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.id, OLD.tenant_id, OLD.base_forecast_run_id, OLD.created_by_user_id, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'scenario ownership is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status = 'archived' THEN
    RAISE EXCEPTION 'scenario is archived'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status = 'ready' THEN
    IF ROW(NEW.name, NEW.description, NEW.shock_config) IS DISTINCT FROM
       ROW(OLD.name, OLD.description, OLD.shock_config) THEN
      RAISE EXCEPTION 'ready scenario is frozen'
        USING ERRCODE = '55000';
    END IF;
    IF NEW.status <> 'archived' THEN
      RAISE EXCEPTION 'invalid scenario status transition'
        USING ERRCODE = '55000';
    END IF;
  ELSIF OLD.status = 'draft' AND NEW.status NOT IN ('draft', 'ready', 'archived') THEN
    RAISE EXCEPTION 'invalid scenario status transition'
      USING ERRCODE = '55000';
  END IF;

  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER scenarios_enforce_lifecycle
BEFORE INSERT OR UPDATE OR DELETE ON scenarios
FOR EACH ROW
EXECUTE FUNCTION enforce_scenario_lifecycle();
