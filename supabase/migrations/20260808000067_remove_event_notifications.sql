-- DIP-FP-100-web: removes server-side notification scheduling entirely —
-- mobile's own local reminder reconciliation is the actual live mechanism,
-- and no dispatch worker for event_notifications was ever built. Drops
-- creation (handle_event_scheduling()'s triple-insert), the redundant
-- EVENT_UPDATE insert and rescheduling logic (removed in
-- src/features/events/service.ts, same commit), and the table itself.
--
-- Critical gap found while grounding this migration, not mentioned anywhere
-- in the DIP: the Grounding Check claims "No RLS policy, other trigger
-- function, or edge function references event_notifications — confirmed via
-- full-migration grep." That grep was incomplete. trigger_suppress_
-- notifications_on_cancel (AFTER UPDATE ON events, function
-- suppress_notifications_on_cancel(), both from 20260629000005_event_state_
-- transitions.sql) is live and wired — confirmed by 20260708000030_cancel_
-- event_with_audit.sql's own header comment ("This trigger is correctly
-- wired and will fire the moment any future cancel endpoint performs the
-- UPDATE; it is not a dead trigger") and by the fact that
-- cancel_event_with_audit() (added in that same later migration) performs
-- exactly the UPDATE events SET status = 'CANCELLED' this trigger fires on.
--
-- Postgres does not validate PL/pgSQL function bodies against dropped tables
-- at DROP TABLE time (unlike a view or FK, a trigger function's body is just
-- text until it executes) — so DROP TABLE event_notifications alone would
-- have succeeded silently here, leaving this trigger as a landmine: working
-- fine until the next real event cancellation, which would then hard-fail
-- with "relation event_notifications does not exist" (42P01). Dropped both
-- the trigger and its function below, before the table itself.

-- ==============================================================
-- SECTION 1: handle_event_scheduling() — remove the event_notifications
-- triple-insert only. event_attendees roster materialization is carried
-- forward completely unchanged, byte-for-byte.
-- ==============================================================

CREATE OR REPLACE FUNCTION handle_event_scheduling()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'SCHEDULED' AND OLD.status = 'DRAFT' THEN
    INSERT INTO event_attendees (tenant_id, event_id, member_id)
    SELECT NEW.tenant_id, NEW.id, a.member_id
    FROM assignments a
    WHERE a.group_id = ANY(
            ARRAY(SELECT jsonb_array_elements_text(NEW.target->'group_ids'))::UUID[]
          )
      AND a.assignment_type = 'GROUP'
      AND a.deleted_at IS NULL
      AND a.tenant_id = NEW.tenant_id
    UNION
    SELECT NEW.tenant_id, NEW.id, m.id
    FROM members m
    WHERE m.id = ANY(
            ARRAY(SELECT jsonb_array_elements_text(NEW.target->'member_ids'))::UUID[]
          )
      AND m.tenant_id = NEW.tenant_id
      AND m.deleted_at IS NULL
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog;


-- ==============================================================
-- SECTION 2: remove the one remaining live dependent this DIP's own grep
-- missed — the cancel-suppression trigger — before dropping the table.
-- ==============================================================

DROP TRIGGER IF EXISTS trigger_suppress_notifications_on_cancel ON events;
DROP FUNCTION IF EXISTS public.suppress_notifications_on_cancel();


-- ==============================================================
-- SECTION 3: drop the table itself — every remaining live reference
-- (handle_event_scheduling, suppress_notifications_on_cancel, and the four
-- call sites in src/features/events/service.ts) has been removed above and
-- in this same commit.
-- ==============================================================

DROP TABLE IF EXISTS event_notifications;
