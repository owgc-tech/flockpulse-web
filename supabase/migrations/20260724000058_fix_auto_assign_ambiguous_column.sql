-- DIP-FP-180-adj-3: fixes Postgres error 42702 ("column reference \"event_id\"
-- is ambiguous") on every "Run auto-assign" call. RETURNS TABLE(...) declared
-- output columns named event_id/task_id, which collided with the real
-- event_tasks_assignments columns referenced bare in
-- ON CONFLICT (event_id, task_id) — PL/pgSQL can't disambiguate, and a
-- conflict target list can't be table-qualified to resolve it manually.
--
-- Same bug, same fix already established in this codebase: see
-- 20260629000017_audit_logs.sql's upsert_rsvp_with_audit(), which switched
-- from RETURNS TABLE to RETURNS SETOF <table> + %ROWTYPE + RETURN NEXT for
-- exactly this reason. Applying that same pattern here rather than the
-- alternative #variable_conflict use_column compiler pragma, for
-- consistency with existing code.
--
-- Return type is changing (TABLE(...) -> SETOF event_tasks_assignments), so
-- CREATE OR REPLACE alone is not sufficient — explicit DROP FUNCTION first,
-- per the standing DIP checklist rule for RPC return-shape changes.

DROP FUNCTION IF EXISTS public.auto_assign_task_slots(UUID, UUID, JSONB, UUID);

CREATE FUNCTION public.auto_assign_task_slots(
    p_tenant_id UUID,
    p_task_id UUID,
    p_roster JSONB,
    p_actor_member_id UUID
)
RETURNS SETOF event_tasks_assignments
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
  v_row event_tasks_assignments%ROWTYPE;
  i INT;
BEGIN
  SELECT array_agg(e.id ORDER BY e.start_datetime ASC, e.id ASC)
  INTO v_event_ids
  FROM events e
  WHERE e.tenant_id = p_tenant_id
    AND public.get_event_effective_status(e.id) IN ('DRAFT', 'SCHEDULED', 'ACTIVE');

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
    RETURNING * INTO v_row;

    RETURN NEXT v_row;
  END LOOP;

  RETURN;
END;
$$;

-- No pre-flight duplicate check needed — this migration doesn't touch the
-- unique index. No explicit GRANT needed — same as prior migrations in this
-- file set.
