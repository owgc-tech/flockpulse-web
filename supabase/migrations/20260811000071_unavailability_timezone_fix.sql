-- DIP-FP-190-web-adj-1: fixes a real timezone-boundary bug found via testing.
-- block_task_assignment_if_member_unavailable() (20260811000070) cast event
-- timestamps to a calendar date using Postgres's default (UTC) session
-- timezone, with no tenant timezone stored anywhere to cast against
-- correctly. A late-evening event in Eastern time could land on the next
-- UTC calendar day, incorrectly matching (or missing) an unavailability
-- range. Confirmed via a controlled test: a 9 AM Eastern event was
-- unaffected, an 11 PM Eastern event on the same calendar date was
-- incorrectly blocked.
--
-- Admin UI to change a tenant's timezone is deliberately out of scope here
-- — OWGC is the only tenant that exists today, the default is already
-- correct for it, and a settings UI for a value nothing currently needs to
-- change is unwarranted scope for what's fundamentally a bug fix.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Toronto';

-- Signature unchanged (RETURNS TRIGGER, no declared params) — plain
-- CREATE OR REPLACE FUNCTION is correct, no DROP FUNCTION needed.

CREATE OR REPLACE FUNCTION public.block_task_assignment_if_member_unavailable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_event RECORD;
  v_member_ids UUID[];
  v_member_id UUID;
  v_member_name TEXT;
BEGIN
  IF current_setting('app.skip_unavailability_check', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF NEW.assignee IS NULL THEN
    RETURN NEW;
  END IF;

  v_member_ids := ARRAY(
    SELECT jsonb_array_elements_text(COALESCE(NEW.assignee->'member_ids', '[]'::jsonb))
  )::UUID[];
  IF v_member_ids IS NULL OR array_length(v_member_ids, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT e.start_datetime, e.end_datetime, t.timezone INTO v_event
  FROM events e JOIN tenants t ON t.id = e.tenant_id
  WHERE e.id = NEW.event_id AND e.tenant_id = NEW.tenant_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  FOREACH v_member_id IN ARRAY v_member_ids LOOP
    IF EXISTS (
      SELECT 1 FROM member_unavailability_ranges mur
      WHERE mur.tenant_id = NEW.tenant_id
        AND mur.member_id = v_member_id
        AND mur.start_date <= (v_event.end_datetime AT TIME ZONE v_event.timezone)::DATE
        AND mur.end_date >= (v_event.start_datetime AT TIME ZONE v_event.timezone)::DATE
    ) THEN
      SELECT (first_name || ' ' || last_name) INTO v_member_name
      FROM members WHERE id = v_member_id;

      RAISE EXCEPTION 'Cannot assign %: marked unavailable on this date — ask them to adjust their unavailability if this assignment is needed', COALESCE(v_member_name, 'this member');
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;
