-- FP-234-web: update_task_assignment acts only on a real change.
--
-- 20261003000074 made update_task_assignment bump events.version and clear
-- responses on EVERY call, even when the assignee did not change (e.g. the event
-- form re-saving an untouched task, or a PATCH with no assignee at all). That
-- makes "something changed" meaningless for anything watching events.version.
--
-- Now the stored assignee is compared with the new one by what it MEANS — the SET
-- of member ids and the SET of group ids (order, duplicates and an absent vs
-- empty array do not count as a change):
--   * nothing changed -> the row is returned as-is: no write, no version bump,
--     no response clearing, updated_at untouched
--   * changed         -> exactly today's behavior (write, clear responses of
--     anyone who no longer resolves, bump the version once)
-- A call with p_assignee_provided = false carries no assignee, so it is a no-op
-- of the same kind.
--
-- Same signature, same SECURITY DEFINER / search_path, same privileges
-- (service_role only), same FP404 not-found error.

CREATE OR REPLACE FUNCTION public.update_task_assignment(
  p_tenant_id UUID, p_id UUID, p_assignee JSONB, p_assignee_provided BOOLEAN
)
RETURNS event_tasks_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_old event_tasks_assignments%ROWTYPE;
  v_row event_tasks_assignments%ROWTYPE;
  v_old_members TEXT[];
  v_new_members TEXT[];
  v_old_groups TEXT[];
  v_new_groups TEXT[];
BEGIN
  SELECT * INTO v_old
  FROM event_tasks_assignments
  WHERE id = p_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event task assignment not found' USING ERRCODE = 'FP404';
  END IF;

  IF NOT p_assignee_provided THEN
    RETURN v_old;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT x ORDER BY x), ARRAY[]::TEXT[]) INTO v_old_members
  FROM jsonb_array_elements_text(COALESCE(v_old.assignee->'member_ids', '[]'::jsonb)) x;
  SELECT COALESCE(array_agg(DISTINCT x ORDER BY x), ARRAY[]::TEXT[]) INTO v_new_members
  FROM jsonb_array_elements_text(COALESCE(p_assignee->'member_ids', '[]'::jsonb)) x;
  SELECT COALESCE(array_agg(DISTINCT x ORDER BY x), ARRAY[]::TEXT[]) INTO v_old_groups
  FROM jsonb_array_elements_text(COALESCE(v_old.assignee->'group_ids', '[]'::jsonb)) x;
  SELECT COALESCE(array_agg(DISTINCT x ORDER BY x), ARRAY[]::TEXT[]) INTO v_new_groups
  FROM jsonb_array_elements_text(COALESCE(p_assignee->'group_ids', '[]'::jsonb)) x;

  IF v_old_members = v_new_members AND v_old_groups = v_new_groups THEN
    RETURN v_old;
  END IF;

  UPDATE event_tasks_assignments
  SET assignee = p_assignee,
      updated_at = now()
  WHERE id = p_id AND tenant_id = p_tenant_id
  RETURNING * INTO v_row;

  PERFORM public.clear_responses_for_removed_assignees(p_tenant_id, v_row.id, v_row.assignee);
  PERFORM public.bump_event_version_for_task_change(p_tenant_id, v_row.event_id);
  RETURN v_row;
END;
$$;

-- CREATE OR REPLACE keeps existing grants; restated so the file is self-evidently
-- service_role-only (FP-228 convention).
REVOKE EXECUTE ON FUNCTION public.update_task_assignment(UUID, UUID, JSONB, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_task_assignment(UUID, UUID, JSONB, BOOLEAN) TO service_role;
