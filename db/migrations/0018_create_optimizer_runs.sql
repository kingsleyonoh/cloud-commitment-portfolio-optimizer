CREATE FUNCTION optimizer_uuid_array_is_canonical(scope_values UUID[], max_items INT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT cardinality(scope_values) BETWEEN 1 AND max_items
    AND array_position(scope_values, NULL) IS NULL
    AND cardinality(scope_values) = (
      SELECT count(DISTINCT value)::INT FROM unnest(scope_values) AS values_list(value)
    );
$$;

CREATE TABLE optimizer_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  forecast_run_id UUID NOT NULL,
  scenario_id UUID DEFAULT NULL,
  optimizer_policy_id UUID NOT NULL,
  provider TEXT NOT NULL,
  instrument TEXT NOT NULL,
  price_table_version_ids UUID[] NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  random_seed BIGINT NOT NULL,
  input_snapshot_uri TEXT NOT NULL,
  output_uri TEXT DEFAULT NULL,
  frontier_uri TEXT DEFAULT NULL,
  infeasibility_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id UUID DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT optimizer_runs_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CONSTRAINT optimizer_runs_tenant_forecast_fkey
    FOREIGN KEY (tenant_id, forecast_run_id)
    REFERENCES forecast_runs(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT optimizer_runs_tenant_scenario_fkey
    FOREIGN KEY (tenant_id, scenario_id)
    REFERENCES scenarios(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT optimizer_runs_tenant_policy_fkey
    FOREIGN KEY (tenant_id, optimizer_policy_id)
    REFERENCES optimizer_policies(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT optimizer_runs_created_by_tenant_fkey
    FOREIGN KEY (tenant_id, created_by_user_id)
    REFERENCES users(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT optimizer_runs_provider_check CHECK (
    provider IN ('aws', 'azure', 'gcp')
  ),
  CONSTRAINT optimizer_runs_instrument_check CHECK (
    instrument IN (
      'aws_compute_savings_plan',
      'aws_reserved_instance',
      'azure_savings_plan',
      'azure_reservation',
      'gcp_committed_use_discount'
    )
  ),
  CONSTRAINT optimizer_runs_provider_instrument_check CHECK (
    (provider = 'aws' AND instrument IN (
      'aws_compute_savings_plan', 'aws_reserved_instance'
    ))
    OR (provider = 'azure' AND instrument IN (
      'azure_savings_plan', 'azure_reservation'
    ))
    OR (provider = 'gcp' AND instrument = 'gcp_committed_use_discount')
  ),
  CONSTRAINT optimizer_runs_price_versions_check CHECK (
    optimizer_uuid_array_is_canonical(price_table_version_ids, 16)
  ),
  CONSTRAINT optimizer_runs_status_check CHECK (
    status IN ('queued', 'running', 'completed', 'failed', 'infeasible', 'cancelled')
  ),
  CONSTRAINT optimizer_runs_input_snapshot_uri_check CHECK (
    input_snapshot_uri = btrim(input_snapshot_uri)
    AND input_snapshot_uri <> ''
    AND length(input_snapshot_uri) <= 2048
    AND input_snapshot_uri !~ '[[:cntrl:]]'
  ),
  CONSTRAINT optimizer_runs_output_uri_check CHECK (
    output_uri IS NULL
    OR (
      output_uri = btrim(output_uri)
      AND output_uri <> ''
      AND length(output_uri) <= 2048
      AND output_uri !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT optimizer_runs_frontier_uri_check CHECK (
    frontier_uri IS NULL
    OR (
      frontier_uri = btrim(frontier_uri)
      AND frontier_uri <> ''
      AND length(frontier_uri) <= 2048
      AND frontier_uri !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT optimizer_runs_infeasibility_object_check CHECK (
    jsonb_typeof(infeasibility_details) = 'object'
    AND octet_length(infeasibility_details::text) <= 65536
    AND NOT infeasibility_details ?| ARRAY[
      'credentials', 'credential', 'password', 'secret', 'token',
      'raw_file', 'raw_bytes', 'raw_row', 'raw_rows'
    ]
  ),
  CONSTRAINT optimizer_runs_error_details_object_check CHECK (
    jsonb_typeof(error_details) = 'object'
    AND octet_length(error_details::text) <= 16384
    AND NOT error_details ?| ARRAY[
      'credentials', 'credential', 'password', 'secret', 'token',
      'stack', 'stack_trace', 'raw_file', 'raw_bytes', 'raw_row', 'raw_rows'
    ]
  ),
  CONSTRAINT optimizer_runs_state_fields_check CHECK (
    (
      status IN ('queued', 'running')
      AND output_uri IS NULL
      AND frontier_uri IS NULL
      AND infeasibility_details = '{}'::jsonb
      AND error_details = '{}'::jsonb
    )
    OR (
      status = 'completed'
      AND output_uri IS NOT NULL
      AND frontier_uri IS NOT NULL
      AND infeasibility_details = '{}'::jsonb
      AND error_details = '{}'::jsonb
    )
    OR (
      status = 'failed'
      AND output_uri IS NULL
      AND frontier_uri IS NULL
      AND infeasibility_details = '{}'::jsonb
      AND error_details <> '{}'::jsonb
    )
    OR (
      status = 'infeasible'
      AND output_uri IS NULL
      AND frontier_uri IS NOT NULL
      AND infeasibility_details <> '{}'::jsonb
      AND error_details = '{}'::jsonb
    )
    OR (
      status = 'cancelled'
      AND output_uri IS NULL
      AND frontier_uri IS NULL
      AND infeasibility_details = '{}'::jsonb
      AND error_details = '{}'::jsonb
    )
  ),
  CONSTRAINT optimizer_runs_timestamps_ordered_check CHECK (
    updated_at >= created_at
  )
);

CREATE UNIQUE INDEX optimizer_runs_tenant_identity_key
ON optimizer_runs (tenant_id, id);

CREATE INDEX optimizer_runs_tenant_status_created_idx
ON optimizer_runs (tenant_id, status, created_at);

CREATE INDEX optimizer_runs_tenant_forecast_policy_idx
ON optimizer_runs (tenant_id, forecast_run_id, optimizer_policy_id);

CREATE INDEX optimizer_runs_tenant_provider_instrument_status_idx
ON optimizer_runs (tenant_id, provider, instrument, status);

CREATE FUNCTION enforce_optimizer_run_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_forecast_status TEXT;
  parent_policy_status TEXT;
  parent_scenario_status TEXT;
  price_count INT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'queued' THEN
      RAISE EXCEPTION 'optimizer runs must be created as queued'
        USING ERRCODE = '23514';
    END IF;

    SELECT status INTO parent_forecast_status
    FROM forecast_runs
    WHERE tenant_id = NEW.tenant_id AND id = NEW.forecast_run_id
    FOR SHARE;

    IF FOUND AND parent_forecast_status <> 'completed' THEN
      RAISE EXCEPTION 'optimizer runs require a completed forecast'
        USING ERRCODE = '55000';
    END IF;

    SELECT status INTO parent_policy_status
    FROM optimizer_policies
    WHERE tenant_id = NEW.tenant_id AND id = NEW.optimizer_policy_id
    FOR SHARE;

    IF FOUND AND parent_policy_status <> 'active' THEN
      RAISE EXCEPTION 'optimizer runs require an active policy'
        USING ERRCODE = '55000';
    END IF;

    IF NEW.scenario_id IS NOT NULL THEN
      SELECT status INTO parent_scenario_status
      FROM scenarios
      WHERE tenant_id = NEW.tenant_id AND id = NEW.scenario_id
      FOR SHARE;

      IF FOUND AND parent_scenario_status <> 'ready' THEN
        RAISE EXCEPTION 'optimizer runs require a ready scenario'
          USING ERRCODE = '55000';
      END IF;
    END IF;

    SELECT count(*)::INT INTO price_count
    FROM price_table_versions version
    WHERE version.id = ANY(NEW.price_table_version_ids)
      AND version.tenant_id = NEW.tenant_id
      AND version.provider = NEW.provider
      AND version.instrument = NEW.instrument
      AND version.status = 'active';

    IF price_count <> cardinality(NEW.price_table_version_ids) THEN
      RAISE EXCEPTION 'optimizer run price versions are invalid'
        USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'optimizer runs cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF ROW(
    NEW.id, NEW.tenant_id, NEW.forecast_run_id, NEW.scenario_id,
    NEW.optimizer_policy_id, NEW.provider, NEW.instrument, NEW.price_table_version_ids,
    NEW.random_seed, NEW.input_snapshot_uri, NEW.created_by_user_id, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.id, OLD.tenant_id, OLD.forecast_run_id, OLD.scenario_id,
    OLD.optimizer_policy_id, OLD.provider, OLD.instrument, OLD.price_table_version_ids,
    OLD.random_seed, OLD.input_snapshot_uri, OLD.created_by_user_id, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'optimizer run inputs are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status IN ('completed', 'failed', 'infeasible', 'cancelled') THEN
    RAISE EXCEPTION 'optimizer run is terminal'
      USING ERRCODE = '55000';
  END IF;

  IF NOT (
    (OLD.status = 'queued' AND NEW.status IN ('running', 'failed', 'cancelled'))
    OR (OLD.status = 'running' AND NEW.status IN ('completed', 'failed', 'infeasible', 'cancelled'))
  ) THEN
    RAISE EXCEPTION 'invalid optimizer run status transition'
      USING ERRCODE = '55000';
  END IF;

  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER optimizer_runs_enforce_lifecycle
BEFORE INSERT OR UPDATE OR DELETE ON optimizer_runs
FOR EACH ROW
EXECUTE FUNCTION enforce_optimizer_run_lifecycle();
