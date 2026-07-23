-- DIP-FP-180-adj-1: root-cause fix — event_tasks_assignments only ever gets a
-- row once someone actually assigns something (EventForm.tsx's own
-- syncTaskAssignments precedent: "an empty core task slot means no assignee,
-- not an assignment row with nobody in it"). The original FP-180 RPC only
-- ever selected existing rows, so it only ever touched already-assigned
-- events — the reverse of the intended behavior. This version drives off
-- every upcoming event directly and upserts.
--
-- PRE-FLIGHT, run manually before applying to fpdb-dev remote (Claude Code
-- cannot check this — Supabase MCP is misconfigured to the wrong org, and CC
-- never applies migrations remotely regardless):
--   SELECT event_id, task_id, count(*) FROM event_tasks_assignments
--   GROUP BY event_id, task_id HAVING count(*) > 1;
-- If this returns any rows, resolve the duplicates before applying — the
-- unique index below will otherwise fail to create.

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_tasks_assignments_unique_event_task
    ON event_tasks_assignments(event_id, task_id);

CREATE OR REPLACE FUNCTION public.auto_assign_task_slots(
    p_tenant_id UUID,
    p_task_id UUID,
    p_roster JSONB,
    p_actor_member_id UUID
)
RETURNS TABLE (
    id UUID, event_id UUID, task_id UUID, assignee JSONB,
    created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_event_ids UUID[];
  v_roster_len INT := jsonb_array_length(p_roster);
  v_entry JSONB;
  v_type TEXT;
  v_rid UUID;
  v_new_assignee JSONB;
  v_touched_ids UUID[] := ARRAY[]::UUID[];
  v_row_id UUID;
  i INT;
BEGIN
  -- Driven by events directly now, not event_tasks_assignments — an event
  -- with no row yet for this task is still an open slot.
  SELECT array_agg(e.id ORDER BY e.start_datetime ASC, e.id ASC)
  INTO v_event_ids
  FROM events e
  WHERE e.tenant_id = p_tenant_id
    AND public.get_event_effective_status(e.id) IN ('SCHEDULED', 'ACTIVE');

  IF v_event_ids IS NULL OR v_roster_len = 0 THEN
    RETURN;
  END IF;

  FOR i IN 1..array_length(v_event_ids, 1) LOOP
    v_entry := p_roster -> ((i - 1) % v_roster_len);
    v_type := v_entry->>'type';
    v_rid := (v_entry->>'id')::UUID;

    IF v_type = 'group' THEN
      v_new_assignee := jsonb_build_object('group_ids', jsonb_build_array(v_rid));
    ELSE
      v_new_assignee := jsonb_build_object('member_ids', jsonb_build_array(v_rid));
    END IF;

    INSERT INTO event_tasks_assignments (tenant_id, event_id, task_id, assignee)
    VALUES (p_tenant_id, v_event_ids[i], p_task_id, v_new_assignee)
    ON CONFLICT (event_id, task_id)
    DO UPDATE SET assignee = EXCLUDED.assignee, updated_at = now()
    RETURNING event_tasks_assignments.id INTO v_row_id;

    v_touched_ids := array_append(v_touched_ids, v_row_id);
  END LOOP;

  RETURN QUERY
  SELECT eta.id, eta.event_id, eta.task_id, eta.assignee, eta.created_at, eta.updated_at
  FROM event_tasks_assignments eta
  WHERE eta.id = ANY(v_touched_ids)
  ORDER BY eta.updated_at DESC;
END;
$$;

-- No explicit GRANT needed — same as the original migration.
