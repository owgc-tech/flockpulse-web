-- FP-47: Replace pg_cron-driven event state writes with time-derived effective status.
-- Supersedes the transition mechanism from FP-13 (20260629000005) only — the state
-- machine itself, and handle_event_scheduling()'s DRAFT->SCHEDULED trigger, are unchanged.


-- ==============================================================
-- SECTION 1: Backfill existing stored ACTIVE/COMPLETED/LOCKED rows
--
-- Safe: the derivation function recomputes the correct effective
-- state from timestamps regardless of what's stored here, as long
-- as it isn't DRAFT or CANCELLED (excluded from this backfill).
-- ==============================================================

UPDATE events
SET status = 'SCHEDULED'
WHERE status IN ('ACTIVE', 'COMPLETED', 'LOCKED');


-- ==============================================================
-- SECTION 2: Tighten events.status CHECK
--
-- ACTIVE/COMPLETED/LOCKED are no longer legal stored values —
-- they only ever exist as a return value of get_event_effective_status().
-- ==============================================================

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_status_check;
ALTER TABLE events
    ADD CONSTRAINT events_status_check
    CHECK (status IN ('DRAFT', 'SCHEDULED', 'CANCELLED'));


-- ==============================================================
-- SECTION 3: get_event_effective_status()
--
-- DRAFT/CANCELLED pass through unchanged — sticky, explicit states
-- with no time-based formula. SCHEDULED events derive ACTIVE/
-- COMPLETED/LOCKED from start_datetime/end_datetime/attendance
-- window, evaluated at query time — never precomputed, never stale.
--
-- Tenant-agnostic by design, matching block_actions_on_cancelled_or_locked's
-- existing convention: callers tenant-scope the event_id before calling.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.get_event_effective_status(p_event_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT CASE
    WHEN e.status IN ('DRAFT', 'CANCELLED') THEN e.status
    WHEN now() < e.start_datetime THEN 'SCHEDULED'
    WHEN now() < e.end_datetime THEN 'ACTIVE'
    WHEN now() < e.end_datetime + (t.attendance_window_hours * INTERVAL '1 hour') THEN 'COMPLETED'
    ELSE 'LOCKED'
  END
  FROM events e
  JOIN tenants t ON t.id = e.tenant_id
  WHERE e.id = p_event_id;
$$;


-- ==============================================================
-- SECTION 4: block_actions_on_cancelled_or_locked() — rewritten, same signature
--
-- REGRESSION GUARD: the original EXISTS(...) implementation returns
-- FALSE (never NULL) for a non-existent event. A naive rewrite using
-- `get_event_effective_status(...) IN (...)` returns NULL for a
-- missing event, not FALSE, because `NULL IN (...)` is NULL in SQL.
-- COALESCE preserves the original contract exactly — this is the
-- specific case the FP-13 test checklist already covers explicitly.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.block_actions_on_cancelled_or_locked(p_event_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE(
    public.get_event_effective_status(p_event_id) IN ('CANCELLED', 'LOCKED'),
    FALSE
  );
$$;


-- ==============================================================
-- SECTION 5: Remove the cron job and transition_event_states()
--
-- Guard the unschedule call — don't assume the job exists on every
-- database this migration might run against. Leave the pg_cron
-- extension itself installed; a future notification worker (EPIC-8)
-- may still want it for polling. Only the one job is removed.
-- ==============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'transition-event-states') THEN
    PERFORM cron.unschedule('transition-event-states');
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.transition_event_states();
