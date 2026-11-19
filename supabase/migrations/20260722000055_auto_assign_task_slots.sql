-- DIP-FP-180: single-task round-robin auto-assignment pass, backing both the
-- Prayer Leader and Food Assignment auto-assign screens. Task-agnostic at
-- this layer — which two tasks it's reachable for is an API-layer decision
-- (autoAssign.service.ts), not enforced here. Roster is trusted pre-validated
-- (tenant-scoped, active, individual_only-compliant) by the caller, mirroring
-- validateAssignee's existing precedent elsewhere in this feature area.
-- Overwrites existing assignee values unconditionally on every call — the
-- UI's confirm-before-run warning is what makes that safe, not this function.

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
  v_slot_ids UUID[];
  v_roster_len INT := jsonb_array_length(p_roster);
  v_entry JSONB;
  v_type TEXT;
  v_rid UUID;
  v_new_assignee JSONB;
  i INT;
BEGIN
  SELECT array_agg(eta.id ORDER BY e.start_datetime ASC, eta.id ASC)
  INTO v_slot_ids
  FROM event_tasks_assignments eta
  JOIN events e ON e.id = eta.event_id
  WHERE eta.tenant_id = p_tenant_id
    AND eta.task_id = p_task_id
    AND public.get_event_effective_status(e.id) IN ('SCHEDULED', 'ACTIVE');

  IF v_slot_ids IS NULL OR v_roster_len = 0 THEN
    RETURN;
  END IF;

  FOR i IN 1..array_length(v_slot_ids, 1) LOOP
    v_entry := p_roster -> ((i - 1) % v_roster_len);
    v_type := v_entry->>'type';
    v_rid := (v_entry->>'id')::UUID;

    IF v_type = 'group' THEN
      v_new_assignee := jsonb_build_object('group_ids', jsonb_build_array(v_rid));
    ELSE
      v_new_assignee := jsonb_build_object('member_ids', jsonb_build_array(v_rid));
    END IF;

    UPDATE event_tasks_assignments
    SET assignee = v_new_assignee, updated_at = now()
    WHERE event_tasks_assignments.id = v_slot_ids[i];
  END LOOP;

  RETURN QUERY
  SELECT eta.id, eta.event_id, eta.task_id, eta.assignee, eta.created_at, eta.updated_at
  FROM event_tasks_assignments eta
  WHERE eta.id = ANY(v_slot_ids)
  ORDER BY eta.updated_at DESC;
END;
$$;

-- No explicit GRANT needed: service_role already covered by migration
-- 20260629000011's ALTER DEFAULT PRIVILEGES; only ever called via the
-- service-role client, matching every other RPC in this file set.
