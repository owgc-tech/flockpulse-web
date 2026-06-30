-- 1. Security Hardening Patch: get_tenant_id()
CREATE OR REPLACE FUNCTION public.get_tenant_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
  SELECT (auth.jwt() ->> 'tenant_id')::UUID;
$$;

-- 2. Create Events Table
CREATE TABLE IF NOT EXISTS events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    event_type_id UUID NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SCHEDULED')),
    start_datetime TIMESTAMPTZ NOT NULL,
    end_datetime TIMESTAMPTZ NOT NULL,
    location_name TEXT NOT NULL,
    target JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CHECK (end_datetime > start_datetime)
);
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenants can access their own events" ON events USING (tenant_id = get_tenant_id());

-- 3. Create Event Attendees Table
CREATE TABLE IF NOT EXISTS event_attendees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (event_id, member_id)
);
ALTER TABLE event_attendees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenants can access their own event attendees" ON event_attendees USING (tenant_id = get_tenant_id());

-- 4. Create Event Notifications Table
CREATE TABLE IF NOT EXISTS event_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL CHECK (purpose IN ('PRE_EVENT_REMINDER', 'POST_EVENT_SELF_REPORT', 'LEADER_CONFIRMATION')),
    scheduled_for TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE event_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenants can access their own event notifications" ON event_notifications USING (tenant_id = get_tenant_id());

-- 5. Trigger for Automation
CREATE OR REPLACE FUNCTION handle_event_scheduling()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'SCHEDULED' AND OLD.status = 'DRAFT' THEN
    -- Materialize Roster
    INSERT INTO event_attendees (tenant_id, event_id, member_id)
    SELECT NEW.tenant_id, NEW.id, member_id
    FROM assignments
    WHERE target_id = (NEW.target->>'group_id')::UUID
    ON CONFLICT DO NOTHING;

    -- Schedule Notifications
    INSERT INTO event_notifications (tenant_id, event_id, purpose, scheduled_for) VALUES
    (NEW.tenant_id, NEW.id, 'PRE_EVENT_REMINDER', NEW.start_datetime - INTERVAL '24 hours'),
    (NEW.tenant_id, NEW.id, 'POST_EVENT_SELF_REPORT', NEW.end_datetime),
    (NEW.tenant_id, NEW.id, 'LEADER_CONFIRMATION', NEW.end_datetime + INTERVAL '2 hours');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_event_scheduling
AFTER UPDATE ON events
FOR EACH ROW EXECUTE FUNCTION handle_event_scheduling();
