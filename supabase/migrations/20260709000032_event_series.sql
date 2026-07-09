-- DIP-FP-63-FP-68: recurring event series
--
-- Atomicity resolution (Grounding Check): FP-63's AC asks for "the same create path (and same
-- validation) as any single event," which read literally would mean calling createEvent() N
-- times from the route/service layer. Section 5 Rule 5 forbids that for a single logical action
-- spanning multiple tables (one event_series row + up to 52 events rows) — a failure partway
-- through N separate calls would leave a half-created series with no rollback. Resolved by
-- doing the whole batch in one SECURITY DEFINER function/transaction below.
--
-- "Same validation" is satisfied without duplicating logic: event_type_id validity
-- (trigger_validate_event_event_type_id), talk_id validity (trigger_validate_event_talk_id,
-- confirmed live to enforce exactly the same rule as validateTalkIdForEvent() — not deleted,
-- same tenant), and datetime ordering (events_check: end_datetime > start_datetime) are all
-- already enforced as BEFORE INSERT triggers/constraints on the events table itself — they fire
-- automatically for every row this function inserts, with no need to reimplement them here.
-- If any occurrence in the batch fails one of these, the whole transaction rolls back.


-- ==============================================================
-- SECTION 1: event_series table
-- ==============================================================

CREATE TABLE IF NOT EXISTS event_series (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    frequency TEXT NOT NULL CHECK (frequency IN ('WEEKLY', 'FORTNIGHTLY', 'MONTHLY')),
    occurrence_count INT NOT NULL,
    day_of_week INT, -- derived from first occurrence's start_datetime, display only
    created_by UUID,
    name TEXT NOT NULL,
    event_type_id UUID NOT NULL,
    location_name TEXT NOT NULL,
    location_address TEXT NOT NULL,
    location_url TEXT,
    target JSONB NOT NULL,
    talk_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE event_series ENABLE ROW LEVEL SECURITY;

-- Matches the enforcement model used everywhere else in this codebase: service-role client +
-- app-layer Admin check. RLS is backstop only — SELECT/INSERT, no UPDATE/DELETE (event_series
-- rows are a fixed reference record, never mutated after creation; each generated event is
-- edited/cancelled individually, not the series).
CREATE POLICY "event_series_select" ON event_series
    FOR SELECT USING (tenant_id = get_tenant_id());
CREATE POLICY "event_series_admin_insert" ON event_series
    FOR INSERT WITH CHECK (tenant_id = get_tenant_id() AND caller_is_admin());

GRANT SELECT, INSERT ON event_series TO authenticated;


-- ==============================================================
-- SECTION 2: events.recurrence_series_id + cross-tenant trigger
-- ==============================================================

ALTER TABLE events ADD COLUMN IF NOT EXISTS recurrence_series_id UUID REFERENCES event_series(id);

CREATE OR REPLACE FUNCTION public.validate_event_series_tenant_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.recurrence_series_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM event_series WHERE id = NEW.recurrence_series_id AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'events.recurrence_series_id % does not belong to tenant %', NEW.recurrence_series_id, NEW.tenant_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_validate_event_series_tenant_scope ON events;
CREATE TRIGGER trigger_validate_event_series_tenant_scope
BEFORE INSERT OR UPDATE ON events
FOR EACH ROW EXECUTE FUNCTION validate_event_series_tenant_scope();


-- ==============================================================
-- SECTION 3: create_event_series_with_audit()
--
-- p_occurrence_dates is precomputed by the TypeScript caller (event-series.service.ts) using
-- the single-sourced computeOccurrenceDates() in event.types.ts — the same function the Create
-- Event screen uses for its live "ends on date" estimate. This function only re-validates the
-- count against the cap; it does not recompute dates, so there is exactly one implementation of
-- the date math, not two that could disagree.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.create_event_series_with_audit(
    p_tenant_id UUID,
    p_frequency TEXT,
    p_occurrence_dates JSONB, -- array of {start_datetime, end_datetime} pairs
    p_name TEXT,
    p_event_type_id UUID,
    p_location_name TEXT,
    p_location_address TEXT,
    p_location_url TEXT,
    p_target JSONB,
    p_talk_id UUID,
    p_actor_member_id UUID
)
RETURNS TABLE (series_id UUID, event_ids UUID[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_series_id UUID;
  v_event_ids UUID[] := '{}';
  v_occurrence JSONB;
  v_event_row events%ROWTYPE;
  v_count INT;
  v_cap INT;
BEGIN
  v_count := jsonb_array_length(p_occurrence_dates);
  IF v_count < 1 THEN
    RAISE EXCEPTION 'occurrence_count must be at least 1';
  END IF;

  v_cap := CASE p_frequency
    WHEN 'WEEKLY' THEN 52
    WHEN 'FORTNIGHTLY' THEN 26
    WHEN 'MONTHLY' THEN 12
    ELSE NULL
  END;
  IF v_cap IS NULL THEN
    RAISE EXCEPTION 'frequency must be WEEKLY, FORTNIGHTLY, or MONTHLY';
  END IF;
  IF v_count > v_cap THEN
    RAISE EXCEPTION 'occurrence_count % exceeds cap % for frequency %', v_count, v_cap, p_frequency;
  END IF;

  INSERT INTO event_series (
    tenant_id, frequency, occurrence_count, day_of_week, created_by,
    name, event_type_id, location_name, location_address, location_url, target, talk_id
  ) VALUES (
    p_tenant_id, p_frequency, v_count,
    EXTRACT(DOW FROM (p_occurrence_dates->0->>'start_datetime')::TIMESTAMPTZ)::INT,
    p_actor_member_id,
    p_name, p_event_type_id, p_location_name, p_location_address, p_location_url, p_target, p_talk_id
  )
  RETURNING id INTO v_series_id;

  FOR v_occurrence IN SELECT * FROM jsonb_array_elements(p_occurrence_dates)
  LOOP
    INSERT INTO events (
      tenant_id, event_type_id, name, status, start_datetime, end_datetime,
      location_name, location_address, location_url, target, talk_id, recurrence_series_id
    ) VALUES (
      p_tenant_id, p_event_type_id, p_name, 'DRAFT',
      (v_occurrence->>'start_datetime')::TIMESTAMPTZ, (v_occurrence->>'end_datetime')::TIMESTAMPTZ,
      p_location_name, p_location_address, p_location_url, p_target, p_talk_id, v_series_id
    )
    RETURNING * INTO v_event_row;

    PERFORM write_audit_log(p_tenant_id, 'event', v_event_row.id, 'create', p_actor_member_id, NULL, to_jsonb(v_event_row));
    v_event_ids := array_append(v_event_ids, v_event_row.id);
  END LOOP;

  RETURN QUERY SELECT v_series_id, v_event_ids;
END;
$$;
