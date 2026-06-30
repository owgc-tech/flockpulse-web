-- DIP-FP-13: pg_cron-driven event state transitions, tenant attendance window (resolves OQ-1)


-- ==============================================================
-- SECTION 1: pg_cron extension
--
-- pg_cron v1.6.4 is available in the local Supabase Docker stack
-- but not yet installed. No config.toml change is required for
-- local dev. For remote/production: confirm your Supabase plan
-- includes pg_cron (Pro and above) before applying this migration.
-- ==============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;


-- ==============================================================
-- SECTION 2: tenants.attendance_window_hours
--
-- Tenant-wide configurable window (in hours) after event.end_datetime
-- before status transitions from COMPLETED to LOCKED. Resolves PIB
-- OQ-1. Default 24 hours per direct user confirmation.
-- ==============================================================

ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS attendance_window_hours INTEGER NOT NULL DEFAULT 24;


-- ==============================================================
-- SECTION 3: event_notifications.status — add CANCELLED
--
-- When an event is cancelled, all its PENDING/RETRYING notifications
-- are suppressed by setting status = 'CANCELLED'. This value was
-- not in the prior CHECK (PENDING, SENT, FAILED, RETRYING).
-- ==============================================================

ALTER TABLE event_notifications DROP CONSTRAINT IF EXISTS event_notifications_status_check;
ALTER TABLE event_notifications
    ADD CONSTRAINT event_notifications_status_check
    CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'RETRYING', 'CANCELLED'));


-- ==============================================================
-- SECTION 4: transition_event_states()
--
-- Called by the pg_cron job every 5 minutes. Runs all three
-- transitions in order so a lagging event (e.g. after a missed
-- cron run) can cascade through multiple states in one pass
-- rather than waiting for the next tick per transition.
--
-- search_path is explicitly fixed — omitting this was the root
-- cause of a security advisory caught in the remediation pass.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.transition_event_states()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- 1. SCHEDULED → ACTIVE when start_datetime has passed.
  UPDATE events
  SET status = 'ACTIVE', updated_at = now()
  WHERE status = 'SCHEDULED'
    AND start_datetime <= now();

  -- 2. ACTIVE → COMPLETED when end_datetime has passed.
  UPDATE events
  SET status = 'COMPLETED', updated_at = now()
  WHERE status = 'ACTIVE'
    AND end_datetime <= now();

  -- 3. COMPLETED → LOCKED when the tenant's attendance window has closed.
  --    Window is measured from end_datetime, not start_datetime — anchoring
  --    to start would allow LOCKED to occur before COMPLETED for events
  --    longer than the window (confirmed with user, OQ-1 resolution).
  UPDATE events
  SET status = 'LOCKED', updated_at = now()
  WHERE status = 'COMPLETED'
    AND end_datetime + (
          SELECT attendance_window_hours
          FROM tenants
          WHERE tenants.id = events.tenant_id
        ) * INTERVAL '1 hour' <= now();
END;
$$;


-- ==============================================================
-- SECTION 5: Schedule cron job — every 5 minutes
--
-- 5-minute interval is a reasonable operational default; no
-- specific frequency is mandated by the PDD or Engineering Spec.
-- The job name 'transition-event-states' is idempotent: if this
-- migration is applied twice (e.g. on a reset), cron.schedule
-- will update the existing job rather than creating a duplicate.
-- ==============================================================

SELECT cron.schedule(
    'transition-event-states',
    '*/5 * * * *',
    'SELECT public.transition_event_states();'
);


-- ==============================================================
-- SECTION 6: block_actions_on_cancelled_or_locked(p_event_id UUID)
--
-- Reusable guard function. Returns TRUE if the event is in a
-- terminal or post-window state where member-facing actions
-- (RSVP, self-report, leader confirmation) must be blocked.
--
-- Expected callers (not yet built — pending EPIC-4/5/6):
--   POST /api/events/:id/rsvp        (EPIC-4)
--   POST /api/events/:id/self-report  (EPIC-5)
--   POST /api/events/:id/confirm      (EPIC-6)
-- Each of those endpoints must call this function and return
-- 422 INVALID_STATE if it returns TRUE.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.block_actions_on_cancelled_or_locked(p_event_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM events
    WHERE id = p_event_id
      AND status IN ('CANCELLED', 'LOCKED')
  );
$$;


-- ==============================================================
-- SECTION 7: Suppress notifications when event is cancelled
--
-- Trigger fires AFTER UPDATE on events. When status transitions
-- to CANCELLED, flips all PENDING and RETRYING notification rows
-- for that event to CANCELLED so they are never dispatched.
--
-- Gap noted: there is currently no API-level cancel endpoint —
-- the CANCELLED status exists in the CHECK constraint (added in
-- migration 000003) but no route sets it. This trigger is
-- correctly wired and will fire the moment any future cancel
-- endpoint performs the UPDATE; it is not a dead trigger.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.suppress_notifications_on_cancel()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.status = 'CANCELLED' AND OLD.status <> 'CANCELLED' THEN
    UPDATE event_notifications
    SET status = 'CANCELLED'
    WHERE event_id = NEW.id
      AND status IN ('PENDING', 'RETRYING');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_suppress_notifications_on_cancel ON events;

CREATE TRIGGER trigger_suppress_notifications_on_cancel
AFTER UPDATE ON events
FOR EACH ROW
EXECUTE FUNCTION suppress_notifications_on_cancel();
