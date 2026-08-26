CREATE TABLE notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  channel TEXT NOT NULL,
  urgency TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  locked_by_admin BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT notification_preferences_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CONSTRAINT notification_preferences_tenant_user_fkey
    FOREIGN KEY (tenant_id, user_id)
    REFERENCES users(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT notification_preferences_channel_check CHECK (channel IN ('in_app', 'email')),
  CONSTRAINT notification_preferences_urgency_check CHECK (urgency IN ('low', 'medium', 'high')),
  CONSTRAINT notification_preferences_event_type_check CHECK (
    event_type = btrim(event_type)
    AND event_type <> ''
    AND length(event_type) <= 200
    AND event_type !~ '[[:cntrl:]]'
  ),
  CONSTRAINT notification_preferences_lock_check CHECK (
    locked_by_admin = false OR (urgency = 'high' AND channel = 'in_app')
  ),
  CONSTRAINT notification_preferences_timestamps_ordered_check CHECK (updated_at >= created_at)
);

CREATE UNIQUE INDEX notification_preferences_tenant_user_event_channel_key
ON notification_preferences (tenant_id, user_id, event_type, channel);

CREATE INDEX notification_preferences_tenant_user_enabled_idx
ON notification_preferences (tenant_id, user_id, enabled);

CREATE INDEX notification_preferences_tenant_event_channel_idx
ON notification_preferences (tenant_id, event_type, channel);

CREATE FUNCTION enforce_notification_preference_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'notification preferences cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.id, NEW.tenant_id, NEW.user_id, NEW.event_type, NEW.channel,
           NEW.created_at) IS DISTINCT FROM
       ROW(OLD.id, OLD.tenant_id, OLD.user_id, OLD.event_type, OLD.channel,
           OLD.created_at) THEN
      RAISE EXCEPTION 'notification preference identity is immutable' USING ERRCODE = '55000';
    END IF;
    NEW.updated_at = clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER notification_preferences_enforce_lifecycle
BEFORE INSERT OR UPDATE OR DELETE ON notification_preferences
FOR EACH ROW
EXECUTE FUNCTION enforce_notification_preference_lifecycle();
