CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  recipient_user_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id UUID NULL,
  template_id TEXT NOT NULL,
  urgency TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'unread',
  read_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT notifications_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CONSTRAINT notifications_tenant_recipient_fkey
    FOREIGN KEY (tenant_id, recipient_user_id)
    REFERENCES users(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT notifications_source_type_check CHECK (
    source_type IN ('import_batch', 'recommendation', 'approval', 'backtest_run', 'ecosystem_event', 'system')
  ),
  CONSTRAINT notifications_urgency_check CHECK (urgency IN ('low', 'medium', 'high')),
  CONSTRAINT notifications_status_check CHECK (status IN ('unread', 'read', 'archived', 'dismissed')),
  CONSTRAINT notifications_event_type_check CHECK (
    event_type = btrim(event_type)
    AND event_type <> ''
    AND length(event_type) <= 200
    AND event_type !~ '[[:cntrl:]]'
  ),
  CONSTRAINT notifications_template_id_check CHECK (
    template_id = btrim(template_id)
    AND template_id <> ''
    AND length(template_id) <= 200
    AND template_id !~ '[[:cntrl:]]'
  ),
  CONSTRAINT notifications_title_check CHECK (
    title = btrim(title)
    AND title <> ''
    AND length(title) <= 300
    AND title !~ '[[:cntrl:]]'
  ),
  CONSTRAINT notifications_body_check CHECK (
    body = btrim(body)
    AND body <> ''
    AND length(body) <= 10000
    AND body !~ '[[:cntrl:]]'
  ),
  CONSTRAINT notifications_payload_check CHECK (
    jsonb_typeof(payload) = 'object'
    AND octet_length(payload::text) <= 1048576
    AND NOT payload ?| ARRAY[
      'credentials', 'credential', 'password', 'secret', 'token',
      'api_key', 'apiKey', 'authorization', 'cookie', 'set-cookie',
      'raw_file', 'raw_bytes', 'raw_row', 'raw_rows', 'candidate_id'
    ]
  ),
  CONSTRAINT notifications_status_read_check CHECK (
    (status = 'unread' AND read_at IS NULL)
    OR (status <> 'unread' AND read_at IS NOT NULL)
  ),
  CONSTRAINT notifications_timestamps_ordered_check CHECK (updated_at >= created_at)
);

CREATE INDEX notifications_tenant_recipient_status_created_idx
ON notifications (tenant_id, recipient_user_id, status, created_at);

CREATE INDEX notifications_tenant_event_created_idx
ON notifications (tenant_id, event_type, created_at);

CREATE INDEX notifications_tenant_source_idx
ON notifications (tenant_id, source_type, source_id);

CREATE FUNCTION enforce_notification_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'notifications cannot be deleted' USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'unread' OR NEW.read_at IS NOT NULL THEN
      RAISE EXCEPTION 'notifications must start unread' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF ROW(NEW.id, NEW.tenant_id, NEW.recipient_user_id, NEW.event_type, NEW.source_type,
         NEW.source_id, NEW.template_id, NEW.urgency, NEW.title, NEW.body, NEW.payload,
         NEW.created_at) IS DISTINCT FROM
     ROW(OLD.id, OLD.tenant_id, OLD.recipient_user_id, OLD.event_type, OLD.source_type,
         OLD.source_id, OLD.template_id, OLD.urgency, OLD.title, OLD.body, OLD.payload,
         OLD.created_at) THEN
    RAISE EXCEPTION 'notification identity is immutable' USING ERRCODE = '55000';
  END IF;

  IF OLD.status IN ('archived', 'dismissed') THEN
    RAISE EXCEPTION 'notification is terminal' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'unread' AND NEW.status NOT IN ('unread', 'read', 'archived', 'dismissed') THEN
    RAISE EXCEPTION 'invalid notification status transition' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'read' AND NEW.status NOT IN ('read', 'archived', 'dismissed') THEN
    RAISE EXCEPTION 'invalid notification status transition' USING ERRCODE = '55000';
  END IF;
  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER notifications_enforce_lifecycle
BEFORE INSERT OR UPDATE OR DELETE ON notifications
FOR EACH ROW
EXECUTE FUNCTION enforce_notification_lifecycle();
