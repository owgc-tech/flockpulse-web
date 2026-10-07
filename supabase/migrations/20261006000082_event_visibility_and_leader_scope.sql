-- DIP-FP-239-web: event visibility and Leader write scope.
--   1. is_member_assigned_to_event(): does a member currently resolve as an
--      assignee of any task on this (non-draft) event — the "assigned" clause
--      of the shared can-open rule (assertCallerCanOpenEvent).
--   2. list_member_visible_events(): the events a Leader-tier caller may see in
--      the web admin Events list — owned or invited (same set as the mobile
--      Events tab before its date/status trimming). Returned as rows so the
--      API can embed, filter, order and page them like a plain events query.
--   3. auto_assign_task_slots(): adds p_owner_member_id (DEFAULT NULL = no
--      scope, Admin tier). A Leader's auto-assign only touches events they own.
--      The 5-argument version is dropped; old code calling with 5 named
--      arguments still resolves to the new function through the default.
-- Idempotent. Apply it as one script (paste the whole file and run once), so
-- the DROP and the CREATE of auto_assign_task_slots go in together.

-- 1 ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_member_assigned_to_event(
  p_tenant_id UUID, p_event_id UUID, p_member_id UUID
)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1
    FROM event_tasks_assignments eta
    JOIN events e ON e.id = eta.event_id AND e.tenant_id = p_tenant_id
    WHERE eta.tenant_id = p_tenant_id
      AND eta.event_id = p_event_id
      AND e.status <> 'DRAFT'
      AND EXISTS (
        SELECT 1 FROM public.resolve_assignee_member_ids(p_tenant_id, eta.assignee) r
        WHERE r.member_id = p_member_id
      )
  )
$$;

REVOKE EXECUTE ON FUNCTION public.is_member_assigned_to_event(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_member_assigned_to_event(UUID, UUID, UUID) TO service_role;

-- 2 ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_member_visible_events(p_tenant_id UUID, p_member_id UUID)
RETURNS SETOF events LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT e.*
  FROM events e
  WHERE e.tenant_id = p_tenant_id
    AND (
      e.owner_member_id = p_member_id
      OR EXISTS (
        SELECT 1 FROM event_attendees ea
        WHERE ea.tenant_id = p_tenant_id AND ea.event_id = e.id AND ea.member_id = p_member_id
      )
    )
$$;

REVOKE EXECUTE ON FUNCTION public.list_member_visible_events(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_member_visible_events(UUID, UUID) TO service_role;

-- 3 ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.auto_assign_task_slots(UUID, UUID, JSONB, UUID, UUID[]);

CREATE OR REPLACE FUNCTION public.auto_assign_task_slots(
    p_tenant_id UUID,
    p_task_id UUID,
    p_roster JSONB,
    p_actor_member_id UUID,
    p_event_type_ids UUID[],
    p_owner_member_id UUID DEFAULT NULL
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
  v_had_row BOOLEAN;
  v_old_assignee JSONB;
  i INT;
BEGIN
  SET LOCAL app.skip_unavailability_check = 'true';

  IF p_event_type_ids IS NULL OR array_length(p_event_type_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  SELECT array_agg(e.id ORDER BY e.start_datetime ASC, e.id ASC)
  INTO v_event_ids
  FROM events e
  WHERE e.tenant_id = p_tenant_id
    AND e.event_type_id = ANY(p_event_type_ids)
    AND e.end_datetime >= now()
    AND public.get_event_effective_status(e.id) IN ('DRAFT', 'SCHEDULED', 'ACTIVE')
    AND (p_owner_member_id IS NULL OR e.owner_member_id = p_owner_member_id);

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

    SELECT assignee INTO v_old_assignee
    FROM event_tasks_assignments
    WHERE event_id = v_event_ids[i] AND task_id = p_task_id;
    v_had_row := FOUND;

    INSERT INTO event_tasks_assignments (tenant_id, event_id, task_id, assignee)
    VALUES (p_tenant_id, v_event_ids[i], p_task_id, v_new_assignee)
    ON CONFLICT (event_id, task_id)
    DO UPDATE SET assignee = EXCLUDED.assignee, updated_at = now()
    RETURNING * INTO v_row;

    IF NOT v_had_row OR v_old_assignee IS DISTINCT FROM v_new_assignee THEN
      PERFORM public.clear_responses_for_removed_assignees(p_tenant_id, v_row.id, v_row.assignee);
      PERFORM public.bump_event_version_for_task_change(p_tenant_id, v_row.event_id);
    END IF;

    RETURN NEXT v_row;
  END LOOP;

  RETURN;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.auto_assign_task_slots(UUID, UUID, JSONB, UUID, UUID[], UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_assign_task_slots(UUID, UUID, JSONB, UUID, UUID[], UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
