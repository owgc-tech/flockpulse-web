-- FP-221-web: functions backing per-person task Commit/Refuse responses.
--
-- Custom SQLSTATEs raised here (the service maps each to a canonical code):
--   FP404  assignment not found in tenant
--   FP403  member is not an active assignee of the assignment  -> FORBIDDEN_SCOPE
--   FP409  event is not open (not SCHEDULED/ACTIVE)
--   FP422  invalid status value
--
-- HARD RULE: nothing in this file (or in any TypeScript path) ever DELETEs from
-- event_task_assignment_responses. Responses are only ever marked
-- is_current = false with a cleared_reason.
--
-- Every new function below is REVOKEd from PUBLIC/anon/authenticated and
-- granted to service_role only: they take p_tenant_id as an argument, so
-- letting a logged-in user call them over PostgREST would let them pick a
-- tenant.


-- ==============================================================
-- SECTION 1: resolve_assignee_member_ids — which members an assignee JSONB
-- resolves to: direct member_ids UNION members of the listed groups
-- (assignments rows with assignment_type = 'GROUP', deleted_at IS NULL, same
-- tenant).
--
-- KEEP IN SYNC with listMyTaskAssignments() in
-- src/features/tasks/eventTaskAssignment.service.ts, which applies the same
-- rule in TypeScript ("member_ids contains me OR any group_ids I belong to").
-- If either side changes, change the other.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.resolve_assignee_member_ids(p_tenant_id UUID, p_assignee JSONB)
RETURNS TABLE (member_id UUID) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT m.member_id FROM (
    SELECT (jsonb_array_elements_text(COALESCE(p_assignee->'member_ids', '[]'::jsonb)))::uuid AS member_id
    UNION
    SELECT a.member_id FROM assignments a
    WHERE a.tenant_id = p_tenant_id AND a.assignment_type = 'GROUP' AND a.deleted_at IS NULL
      AND a.group_id IN (SELECT (jsonb_array_elements_text(COALESCE(p_assignee->'group_ids', '[]'::jsonb)))::uuid)
  ) m
$$;

REVOKE EXECUTE ON FUNCTION public.resolve_assignee_member_ids(UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_assignee_member_ids(UUID, JSONB) TO service_role;


-- ==============================================================
-- SECTION 2: internal helpers shared by the atomic writers
-- ==============================================================

-- A task-assignment write counts as a modification of the event, so it bumps
-- events.version (a plain counter, not a concurrency token — nothing compares
-- it) and updated_at.
CREATE OR REPLACE FUNCTION public.bump_event_version_for_task_change(p_tenant_id UUID, p_event_id UUID)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  UPDATE events SET version = events.version + 1, updated_at = now()
  WHERE events.id = p_event_id AND events.tenant_id = p_tenant_id;
$$;

-- Marks the current responses of every member who no longer resolves under
-- p_assignee as cleared. History rows are kept.
CREATE OR REPLACE FUNCTION public.clear_responses_for_removed_assignees(
  p_tenant_id UUID, p_assignment_id UUID, p_assignee JSONB
)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  UPDATE event_task_assignment_responses r
  SET is_current = false, cleared_at = now(), cleared_reason = 'REMOVED_FROM_ASSIGNMENT'
  WHERE r.tenant_id = p_tenant_id
    AND r.assignment_id = p_assignment_id
    AND r.is_current
    AND NOT EXISTS (
      SELECT 1 FROM public.resolve_assignee_member_ids(p_tenant_id, p_assignee) x
      WHERE x.member_id = r.member_id
    );
$$;

REVOKE EXECUTE ON FUNCTION public.bump_event_version_for_task_change(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bump_event_version_for_task_change(UUID, UUID) TO service_role;
REVOKE EXECUTE ON FUNCTION public.clear_responses_for_removed_assignees(UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_responses_for_removed_assignees(UUID, UUID, JSONB) TO service_role;


-- ==============================================================
-- SECTION 3: submit_task_assignment_response
--
-- Does NOT touch events.version or updated_at: a Commit/Refuse is not a
-- modification of the event.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.submit_task_assignment_response(
  p_tenant_id UUID,
  p_assignment_id UUID,
  p_member_id UUID,
  p_status TEXT
)
RETURNS event_task_assignment_responses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_assignment event_tasks_assignments%ROWTYPE;
  v_effective TEXT;
  v_current event_task_assignment_responses%ROWTYPE;
  v_new event_task_assignment_responses%ROWTYPE;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('COMMITTED', 'REFUSED') THEN
    RAISE EXCEPTION 'status must be COMMITTED or REFUSED' USING ERRCODE = 'FP422';
  END IF;

  -- Row lock serializes concurrent submits for one assignment (so the
  -- one-current-row unique index is never raced) and holds the assignee steady
  -- against a concurrent update while membership is checked.
  SELECT * INTO v_assignment
  FROM event_tasks_assignments
  WHERE id = p_assignment_id AND tenant_id = p_tenant_id
  FOR NO KEY UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event task assignment not found' USING ERRCODE = 'FP404';
  END IF;

  v_effective := public.get_event_effective_status(v_assignment.event_id);
  IF v_effective IS NULL OR v_effective NOT IN ('SCHEDULED', 'ACTIVE') THEN
    RAISE EXCEPTION 'Responses are only accepted while the event is scheduled or active' USING ERRCODE = 'FP409';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM members WHERE id = p_member_id AND tenant_id = p_tenant_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Member is not active in this tenant' USING ERRCODE = 'FP403';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.resolve_assignee_member_ids(p_tenant_id, v_assignment.assignee) x
    WHERE x.member_id = p_member_id
  ) THEN
    RAISE EXCEPTION 'Member is not assigned to this task' USING ERRCODE = 'FP403';
  END IF;

  SELECT * INTO v_current
  FROM event_task_assignment_responses
  WHERE assignment_id = p_assignment_id AND member_id = p_member_id AND is_current
  FOR UPDATE;

  IF FOUND THEN
    IF v_current.status = p_status THEN
      RETURN v_current;  -- idempotent: same answer again changes nothing
    END IF;

    UPDATE event_task_assignment_responses
    SET is_current = false, cleared_at = now(), cleared_reason = 'SUPERSEDED'
    WHERE id = v_current.id;
  END IF;

  INSERT INTO event_task_assignment_responses (tenant_id, assignment_id, event_id, task_id, member_id, status)
  VALUES (p_tenant_id, v_assignment.id, v_assignment.event_id, v_assignment.task_id, p_member_id, p_status)
  RETURNING * INTO v_new;

  RETURN v_new;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_task_assignment_response(UUID, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_task_assignment_response(UUID, UUID, UUID, TEXT) TO service_role;


-- ==============================================================
-- SECTION 4: atomic assignment writers. Each does the original write plus the
-- version bump (and response clearing where relevant) in one transaction.
-- ==============================================================

-- create: insert, bump the event's version.
CREATE OR REPLACE FUNCTION public.create_task_assignment(
  p_tenant_id UUID, p_event_id UUID, p_task_id UUID, p_assignee JSONB
)
RETURNS event_tasks_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_row event_tasks_assignments%ROWTYPE;
BEGIN
  INSERT INTO event_tasks_assignments (tenant_id, event_id, task_id, assignee)
  VALUES (p_tenant_id, p_event_id, p_task_id, p_assignee)
  RETURNING * INTO v_row;

  PERFORM public.bump_event_version_for_task_change(p_tenant_id, v_row.event_id);
  RETURN v_row;
END;
$$;

-- update: patch the assignee (only when p_assignee_provided — matches the
-- previous PATCH, which touched only updated_at when no assignee was sent),
-- clear responses of anyone who no longer resolves, bump the version.
CREATE OR REPLACE FUNCTION public.update_task_assignment(
  p_tenant_id UUID, p_id UUID, p_assignee JSONB, p_assignee_provided BOOLEAN
)
RETURNS event_tasks_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_row event_tasks_assignments%ROWTYPE;
BEGIN
  UPDATE event_tasks_assignments
  SET assignee = CASE WHEN p_assignee_provided THEN p_assignee ELSE event_tasks_assignments.assignee END,
      updated_at = now()
  WHERE id = p_id AND tenant_id = p_tenant_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event task assignment not found' USING ERRCODE = 'FP404';
  END IF;

  IF p_assignee_provided THEN
    PERFORM public.clear_responses_for_removed_assignees(p_tenant_id, v_row.id, v_row.assignee);
  END IF;

  PERFORM public.bump_event_version_for_task_change(p_tenant_id, v_row.event_id);
  RETURN v_row;
END;
$$;

-- delete: clear every current response, then delete the assignment (history
-- rows survive; their assignment_id becomes NULL via ON DELETE SET NULL),
-- bump the version. Returns false when there was nothing to delete.
CREATE OR REPLACE FUNCTION public.delete_task_assignment(p_tenant_id UUID, p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_event_id UUID;
BEGIN
  SELECT event_id INTO v_event_id
  FROM event_tasks_assignments
  WHERE id = p_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE event_task_assignment_responses
  SET is_current = false, cleared_at = now(), cleared_reason = 'ASSIGNMENT_DELETED'
  WHERE tenant_id = p_tenant_id AND assignment_id = p_id AND is_current;

  DELETE FROM event_tasks_assignments WHERE id = p_id AND tenant_id = p_tenant_id;

  PERFORM public.bump_event_version_for_task_change(p_tenant_id, v_event_id);
  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_task_assignment(UUID, UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_task_assignment(UUID, UUID, UUID, JSONB) TO service_role;
REVOKE EXECUTE ON FUNCTION public.update_task_assignment(UUID, UUID, JSONB, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_task_assignment(UUID, UUID, JSONB, BOOLEAN) TO service_role;
REVOKE EXECUTE ON FUNCTION public.delete_task_assignment(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_task_assignment(UUID, UUID) TO service_role;


-- ==============================================================
-- SECTION 5: auto_assign_task_slots — CREATE OR REPLACE of the latest
-- definition (20260811000070), same signature and RETURNS, behavior preserved
-- exactly. Additions, all inside the per-event loop:
--   * read the slot's previous assignee before the upsert
--   * after the upsert, if the slot was newly created or its assignee changed:
--     clear responses of members who no longer resolve, and bump that event's
--     version once (each event appears once in v_event_ids, so once per event).
-- The upsert itself (including updated_at = now() on every conflict) and the
-- returned rows are untouched. Grants are unchanged by CREATE OR REPLACE.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.auto_assign_task_slots(
    p_tenant_id UUID,
    p_task_id UUID,
    p_roster JSONB,
    p_actor_member_id UUID,
    p_event_type_ids UUID[]
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
