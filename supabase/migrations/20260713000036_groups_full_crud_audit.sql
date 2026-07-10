-- FP-70/FP-71: Groups full CRUD + audit trail; cascades soft-delete to active GROUP
-- assignments (flagged design decision, see DIP-FP-70-FP-71 Grounding Check).
--
-- Confirmed live before writing this (per DIP-FP-70-FP-71 Grounding Check, none assumed):
--   - groups had exactly (id, tenant_id, name, created_at) — no updated_at/created_by/
--     updated_by/deleted_at, and RLS had SELECT + INSERT policies only, no UPDATE/DELETE.
--   - write_audit_log(p_tenant_id, p_entity_type, p_entity_id, p_action, p_actor_id,
--     p_before, p_after) is the established shared helper — used here, not a raw INSERT.
--   - caller_is_admin() exists (used elsewhere in this codebase's RLS policies).

ALTER TABLE groups
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES members(id),
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES members(id),
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;


-- ==============================================================
-- SECTION 1: RLS — non-admin SELECT excludes deactivated groups;
-- admin can see all (audit/restore); admin-only UPDATE (reachable
-- regardless of deleted_at, same reasoning as members_update_admin).
-- ==============================================================

DROP POLICY IF EXISTS "Groups are visible to members of the same tenant" ON groups;
CREATE POLICY "groups_select" ON groups
  FOR SELECT USING (tenant_id = get_tenant_id() AND deleted_at IS NULL);
CREATE POLICY "groups_select_admin_all" ON groups
  FOR SELECT USING (
    tenant_id = get_tenant_id()
    AND EXISTS (SELECT 1 FROM members m WHERE m.user_id = auth.uid() AND m.tenant_id = get_tenant_id() AND m.role = 'ADMIN' AND m.deleted_at IS NULL)
  );

CREATE POLICY "groups_update_admin" ON groups
  FOR UPDATE
  USING (
    tenant_id = get_tenant_id()
    AND EXISTS (SELECT 1 FROM members m WHERE m.user_id = auth.uid() AND m.tenant_id = get_tenant_id() AND m.role = 'ADMIN' AND m.deleted_at IS NULL)
  )
  WITH CHECK (tenant_id = get_tenant_id());


-- ==============================================================
-- SECTION 2: create_group_with_audit()
-- ==============================================================

CREATE OR REPLACE FUNCTION public.create_group_with_audit(
  p_tenant_id UUID, p_name TEXT, p_actor_member_id UUID
)
RETURNS TABLE (id UUID, name TEXT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE v_row groups%ROWTYPE;
BEGIN
  INSERT INTO groups (tenant_id, name, created_by)
  VALUES (p_tenant_id, p_name, p_actor_member_id)
  RETURNING * INTO v_row;

  PERFORM write_audit_log(p_tenant_id, 'group', v_row.id, 'CREATE_GROUP', p_actor_member_id, NULL, jsonb_build_object('name', p_name));

  RETURN QUERY SELECT v_row.id, v_row.name, v_row.created_at;
END;
$$;


-- ==============================================================
-- SECTION 3: update_group_with_audit()
-- ==============================================================

CREATE OR REPLACE FUNCTION public.update_group_with_audit(
  p_group_id UUID, p_tenant_id UUID, p_name TEXT, p_actor_member_id UUID
)
RETURNS TABLE (id UUID, name TEXT, updated_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE v_old_name TEXT; v_row groups%ROWTYPE;
BEGIN
  SELECT g.name INTO v_old_name FROM groups g WHERE g.id = p_group_id AND g.tenant_id = p_tenant_id AND g.deleted_at IS NULL;
  IF v_old_name IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND_IN_TENANT: group % not found in tenant %', p_group_id, p_tenant_id;
  END IF;

  UPDATE groups SET name = p_name, updated_at = now(), updated_by = p_actor_member_id
  WHERE groups.id = p_group_id AND groups.tenant_id = p_tenant_id
  RETURNING * INTO v_row;

  PERFORM write_audit_log(p_tenant_id, 'group', p_group_id, 'UPDATE_GROUP', p_actor_member_id,
    jsonb_build_object('name', v_old_name), jsonb_build_object('name', p_name));

  RETURN QUERY SELECT v_row.id, v_row.name, v_row.updated_at;
END;
$$;


-- ==============================================================
-- SECTION 4: soft_delete_group_with_audit()
-- Flagged cascade decision: retire active GROUP assignments rather than leave them
-- pointed at a deactivated group. All in one transaction (three-table write: groups,
-- assignments, audit_logs).
-- ==============================================================

CREATE OR REPLACE FUNCTION public.soft_delete_group_with_audit(
  p_group_id UUID, p_tenant_id UUID, p_actor_member_id UUID
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE v_exists BOOLEAN; v_retired_count INT;
BEGIN
  SELECT EXISTS (SELECT 1 FROM groups WHERE id = p_group_id AND tenant_id = p_tenant_id AND deleted_at IS NULL) INTO v_exists;
  IF NOT v_exists THEN
    RAISE EXCEPTION 'NOT_FOUND_IN_TENANT: group % not found in tenant %', p_group_id, p_tenant_id;
  END IF;

  UPDATE groups SET deleted_at = now(), updated_by = p_actor_member_id
  WHERE groups.id = p_group_id AND groups.tenant_id = p_tenant_id;

  WITH retired AS (
    UPDATE assignments SET deleted_at = now()
    WHERE assignments.group_id = p_group_id
      AND assignments.tenant_id = p_tenant_id
      AND assignments.assignment_type = 'GROUP'
      AND assignments.deleted_at IS NULL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_retired_count FROM retired;

  PERFORM write_audit_log(p_tenant_id, 'group', p_group_id, 'DEACTIVATE_GROUP', p_actor_member_id,
    jsonb_build_object('deleted_at', NULL),
    jsonb_build_object('deleted_at', now(), 'memberships_retired', v_retired_count));
END;
$$;
