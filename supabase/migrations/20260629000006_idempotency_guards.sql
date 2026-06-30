-- fix/FP-13-FOLLOWUP: Idempotency guards for non-guarded statements in prior migrations
--
-- Context: supabase db reset always starts from a clean (dropped) database, so none of
-- these statements cause failures in the standard reset workflow. They become a problem
-- only when a migration is re-applied to an already-partially-migrated database (e.g.
-- a botched remote push, a CI pipeline that re-runs migrations without resetting, or
-- manual re-application after a partial failure).
--
-- All guards are additive: they ensure the objects exist correctly without failing if
-- a prior migration already created them. None alter any existing behavior.
--
-- Audit findings from migrations 000000–000005:
--   000001  CREATE UNIQUE INDEX idx_members_unique_active_email_per_tenant — no IF NOT EXISTS
--   000002  CREATE TRIGGER trigger_event_scheduling — no DROP TRIGGER IF EXISTS before it
--   000003  ADD CONSTRAINT assignments_typed_fk_check — no DROP CONSTRAINT IF EXISTS guard
--   000005  ADD CONSTRAINT tenants_attendance_window_hours_check — primary reported failure
-- Already guarded (no action needed):
--   000003  events_status_check — preceded by DROP CONSTRAINT IF EXISTS
--   000004  event_notifications_status_check — preceded by DROP CONSTRAINT IF EXISTS
--   000004  event_notifications_purpose_check — preceded by DROP CONSTRAINT IF EXISTS
--   000005  event_notifications_status_check — preceded by DROP CONSTRAINT IF EXISTS
--   000005  trigger_suppress_notifications_on_cancel — preceded by DROP TRIGGER IF EXISTS


-- ==============================================================
-- FIX 1 (primary): tenants_attendance_window_hours_check
-- From migration 000005 — bare ADD CONSTRAINT, no guard.
-- ==============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_attendance_window_hours_check'
  ) THEN
    ALTER TABLE tenants
        ADD CONSTRAINT tenants_attendance_window_hours_check
        CHECK (attendance_window_hours >= 1 AND attendance_window_hours <= 720);
  END IF;
END $$;


-- ==============================================================
-- FIX 2: idx_members_unique_active_email_per_tenant
-- From migration 000001 — CREATE UNIQUE INDEX without IF NOT EXISTS.
-- ==============================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_members_unique_active_email_per_tenant
ON members(tenant_id, email)
WHERE (deleted_at IS NULL);


-- ==============================================================
-- FIX 3: trigger_event_scheduling
-- From migration 000002 — CREATE TRIGGER with no DROP TRIGGER IF EXISTS.
-- Re-creating with DROP + CREATE OR REPLACE pattern to make future
-- re-applies safe. OR REPLACE requires Postgres 14+; Supabase uses
-- Postgres 15/16/17 so this is safe. The function itself already uses
-- CREATE OR REPLACE, so only the trigger needs guarding.
-- ==============================================================

DROP TRIGGER IF EXISTS trigger_event_scheduling ON events;

CREATE TRIGGER trigger_event_scheduling
AFTER UPDATE ON events
FOR EACH ROW EXECUTE FUNCTION handle_event_scheduling();


-- ==============================================================
-- FIX 4: assignments_typed_fk_check
-- From migration 000003 — bare ADD CONSTRAINT, no DROP ... IF EXISTS guard.
-- ==============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'assignments_typed_fk_check'
  ) THEN
    ALTER TABLE assignments
        ADD CONSTRAINT assignments_typed_fk_check CHECK (
            (assignment_type = 'GROUP'  AND group_id IS NOT NULL AND leader_member_id IS NULL)
            OR
            (assignment_type = 'LEADER' AND leader_member_id IS NOT NULL AND group_id IS NULL)
        );
  END IF;
END $$;
