-- FP-69/FP-72: cross-tenant safety trigger for assignments FKs (gap left open since
-- 20260629000003) + atomic Pastoral Leader replace RPC.
--
-- Confirmed live before writing this (per DIP-FP-69-FP-72 Grounding Check, none assumed):
--   - assignments has no BEFORE INSERT/UPDATE trigger at all today (pg_trigger returned zero
--     rows) — group_id/leader_member_id are bare FKs, existence-only, no tenant check. Real gap.
--   - audit_logs columns are (id, tenant_id, entity_type, entity_id, action, actor_id,
--     before_value, after_value, created_at) — there is no "timestamp" column. The DIP's draft
--     migration used "timestamp" and a raw INSERT INTO audit_logs; both are fixed here.
--   - Every existing audit-writing function (e.g. cancel_event_with_audit(),
--     insert_event_with_audit()) calls the shared write_audit_log(p_tenant_id, p_entity_type,
--     p_entity_id, p_action, p_actor_id, p_before, p_after) helper rather than inserting
--     directly, and actor_id is always populated with a members.id (resolved server-side from
--     ctx.memberId), never auth.uid(). The DIP's draft named the actor param p_actor_user_id
--     and inserted directly — both deviate from the established, verified-live convention.
--     Fixed to call write_audit_log() with a p_actor_member_id parameter, matching every other
--     function in this codebase exactly.


-- ==============================================================
-- SECTION 1: cross-tenant validation trigger for assignments.
-- Bare FKs on group_id/leader_member_id only confirm the referenced row
-- exists, not that it belongs to the same tenant as the assignment row.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.validate_assignment_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.group_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM groups g
      WHERE g.id = NEW.group_id AND g.tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'CROSS_TENANT_ACCESS: group_id % does not belong to tenant %', NEW.group_id, NEW.tenant_id;
    END IF;
  END IF;

  IF NEW.leader_member_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM members m
      WHERE m.id = NEW.leader_member_id
        AND m.tenant_id = NEW.tenant_id
        AND m.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'CROSS_TENANT_ACCESS: leader_member_id % does not belong to tenant % or is inactive', NEW.leader_member_id, NEW.tenant_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_validate_assignment_tenant ON assignments;
CREATE TRIGGER trigger_validate_assignment_tenant
BEFORE INSERT OR UPDATE ON assignments
FOR EACH ROW EXECUTE FUNCTION validate_assignment_tenant();


-- ==============================================================
-- SECTION 2: atomic Pastoral Leader replace.
-- The partial unique index idx_assignments_unique_active_leader only
-- blocks duplicating the SAME (member, leader) pair — it does not stop
-- a member from having two different active LEADER assignments at once.
-- This function makes "set the Pastoral Leader" a single atomic action:
-- retire any existing active LEADER assignment(s), then insert the new
-- one (or stop after retiring, if clearing).
-- ==============================================================

CREATE OR REPLACE FUNCTION public.set_member_pastoral_leader(
    p_member_id UUID,
    p_leader_member_id UUID,   -- NULL clears the Pastoral Leader
    p_tenant_id UUID,
    p_actor_member_id UUID
)
RETURNS TABLE (id UUID, member_id UUID, leader_member_id UUID, created_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_old_leader_id UUID;
  v_new_row assignments%ROWTYPE;
BEGIN
  SELECT a.leader_member_id INTO v_old_leader_id
  FROM assignments a
  WHERE a.member_id = p_member_id
    AND a.tenant_id = p_tenant_id
    AND a.assignment_type = 'LEADER'
    AND a.deleted_at IS NULL
  LIMIT 1;

  -- Defensive: soft-delete ALL existing active LEADER assignments for this member, not just
  -- one — more than one may exist today since the unique index never prevented it.
  UPDATE assignments
  SET deleted_at = now()
  WHERE assignments.member_id = p_member_id
    AND assignments.tenant_id = p_tenant_id
    AND assignments.assignment_type = 'LEADER'
    AND assignments.deleted_at IS NULL;

  IF p_leader_member_id IS NULL THEN
    IF v_old_leader_id IS NOT NULL THEN
      PERFORM write_audit_log(
        p_tenant_id, 'assignment', p_member_id, 'CLEAR_PASTORAL_LEADER', p_actor_member_id,
        jsonb_build_object('leader_member_id', v_old_leader_id),
        jsonb_build_object('leader_member_id', NULL)
      );
    END IF;
    RETURN;
  END IF;

  -- trigger_validate_assignment_tenant fires automatically on this INSERT and enforces
  -- same-tenant/active-leader — nothing to duplicate here.
  INSERT INTO assignments (tenant_id, member_id, assignment_type, leader_member_id)
  VALUES (p_tenant_id, p_member_id, 'LEADER', p_leader_member_id)
  RETURNING * INTO v_new_row;

  PERFORM write_audit_log(
    p_tenant_id, 'assignment', v_new_row.id, 'SET_PASTORAL_LEADER', p_actor_member_id,
    jsonb_build_object('leader_member_id', v_old_leader_id),
    jsonb_build_object('leader_member_id', p_leader_member_id)
  );

  RETURN QUERY SELECT v_new_row.id, v_new_row.member_id, v_new_row.leader_member_id, v_new_row.created_at;
END;
$$;
