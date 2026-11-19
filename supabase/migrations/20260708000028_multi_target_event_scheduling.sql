-- DIP-FP-58-FP-59-FP-62: multi-group/multi-member event targeting
--
-- events.target changes conceptually from {group_id} to {group_ids: string[], member_ids: string[]}.
-- No existing events rows in any environment use the old single-group_id shape (confirmed live —
-- events table is empty in local dev, and no application code outside this trigger ever read
-- target->>'group_id'), so no backfill is needed.
--
-- Roster materialization: union every member belonging to any group in target->'group_ids'
-- with every member_id explicitly listed in target->'member_ids'. Both halves are tenant-scoped
-- in the WHERE clause itself (a.tenant_id = NEW.tenant_id / m.tenant_id = NEW.tenant_id) — a
-- client-supplied group_id or member_id belonging to a different tenant simply won't match and
-- contributes no rows, so no cross-tenant row can reach event_attendees.
--
-- "Everyone" is not a special case — it's just a group containing every member, resolved through
-- the same group_ids branch as any other group.
--
-- Notification-scheduling block below is unchanged from the current live version (confirmed via
-- pg_proc before writing this) — only the roster-materialization INSERT's SELECT is rewritten.

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

    INSERT INTO event_notifications (tenant_id, event_id, purpose, scheduled_for) VALUES
    (NEW.tenant_id, NEW.id, 'PRE_EVENT_REMINDER',      NEW.start_datetime - INTERVAL '24 hours'),
    (NEW.tenant_id, NEW.id, 'POST_EVENT_SELF_REPORT',  NEW.end_datetime),
    (NEW.tenant_id, NEW.id, 'LEADER_CONFIRMATION',     NEW.end_datetime + INTERVAL '2 hours');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog;
