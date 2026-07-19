-- DIP-FP-146: transferable group Owner (owner_member_id), distinct from the
-- existing immutable created_by. Deactivation guard + single/bulk
-- reassignment mirror the exact FP-73/74 Pastoral Leader precedent.
--
-- Migration idempotency: create_group_with_audit's RETURNS TABLE signature
-- (id UUID, name TEXT, created_at TIMESTAMPTZ) is unchanged from
-- 20260713000036_groups_full_crud_audit.sql, so a plain CREATE OR REPLACE
-- suffices — no DROP FUNCTION IF EXISTS needed, per house rule.
-- reassign_group_owner_with_audit and bulk_reassign_group_owner_with_audit
-- are brand new functions (no prior signature to conflict with).
-- block_member_deactivation_if_owns_groups is a new, independent trigger
-- (members already has one BEFORE UPDATE trigger for the Pastoral Leader
-- guard from FP-73/74 — this adds a second, per the one-trigger-per-guard-
-- reason convention, not a merge into the existing one).

ALTER TABLE groups ADD COLUMN IF NOT EXISTS owner_member_id UUID REFERENCES members(id);
UPDATE groups SET owner_member_id = created_by WHERE owner_member_id IS NULL;

CREATE OR REPLACE FUNCTION public.create_group_with_audit(
  p_tenant_id UUID, p_name TEXT, p_actor_member_id UUID
)
RETURNS TABLE (id UUID, name TEXT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE v_row groups%ROWTYPE;
BEGIN
  INSERT INTO groups (tenant_id, name, created_by, owner_member_id)
  VALUES (p_tenant_id, p_name, p_actor_member_id, p_actor_member_id)
  RETURNING * INTO v_row;

  PERFORM write_audit_log(p_tenant_id, 'group', v_row.id, 'CREATE_GROUP', p_actor_member_id, NULL, jsonb_build_object('name', p_name));

  RETURN QUERY SELECT v_row.id, v_row.name, v_row.created_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.reassign_group_owner_with_audit(
  p_group_id UUID, p_tenant_id UUID, p_new_owner_member_id UUID, p_actor_member_id UUID
)
RETURNS TABLE (id UUID, owner_member_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE v_old_owner UUID; v_row groups%ROWTYPE; v_new_owner_valid BOOLEAN;
BEGIN
  SELECT g.owner_member_id INTO v_old_owner FROM groups g
    WHERE g.id = p_group_id AND g.tenant_id = p_tenant_id AND g.deleted_at IS NULL;
  -- NOTE: this function's RETURNS TABLE(id UUID, ...) introduces an OUT parameter named
  -- `id`, so the EXISTS check below must alias-qualify g.id — a bare `id` here is ambiguous
  -- against that OUT parameter (caught via local supabase db reset + a live RPC smoke test).
  IF v_old_owner IS NULL AND NOT EXISTS (SELECT 1 FROM groups g WHERE g.id = p_group_id AND g.tenant_id = p_tenant_id AND g.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'NOT_FOUND_IN_TENANT: group % not found in tenant %', p_group_id, p_tenant_id;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM members m WHERE m.id = p_new_owner_member_id AND m.tenant_id = p_tenant_id AND m.deleted_at IS NULL
  ) INTO v_new_owner_valid;
  IF NOT v_new_owner_valid THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: new owner % is not an active member of this tenant', p_new_owner_member_id;
  END IF;

  UPDATE groups SET owner_member_id = p_new_owner_member_id, updated_at = now(), updated_by = p_actor_member_id
  WHERE groups.id = p_group_id AND groups.tenant_id = p_tenant_id
  RETURNING * INTO v_row;

  PERFORM write_audit_log(p_tenant_id, 'group', p_group_id, 'REASSIGN_GROUP_OWNER', p_actor_member_id,
    jsonb_build_object('owner_member_id', v_old_owner), jsonb_build_object('owner_member_id', p_new_owner_member_id));

  RETURN QUERY SELECT v_row.id, v_row.owner_member_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.bulk_reassign_group_owner_with_audit(
  p_outgoing_owner_id UUID, p_incoming_owner_id UUID, p_tenant_id UUID, p_actor_member_id UUID
)
RETURNS TABLE (reassigned_count INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE v_group_id UUID; v_count INT := 0;
BEGIN
  IF p_outgoing_owner_id = p_incoming_owner_id THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: outgoing and incoming owner must be different members';
  END IF;

  FOR v_group_id IN
    SELECT g.id FROM groups g
    WHERE g.owner_member_id = p_outgoing_owner_id AND g.tenant_id = p_tenant_id AND g.deleted_at IS NULL
  LOOP
    PERFORM reassign_group_owner_with_audit(v_group_id, p_tenant_id, p_incoming_owner_id, p_actor_member_id);
    v_count := v_count + 1;
  END LOOP;

  RETURN QUERY SELECT v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.block_member_deactivation_if_owns_groups()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE v_count INT;
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    SELECT COUNT(*) INTO v_count FROM groups WHERE owner_member_id = NEW.id AND deleted_at IS NULL;
    IF v_count > 0 THEN
      RAISE EXCEPTION 'Cannot deactivate member %: still owns % group(s) — reassign ownership first', NEW.id, v_count;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_block_member_deactivation_if_owns_groups ON members;
CREATE TRIGGER trigger_block_member_deactivation_if_owns_groups
BEFORE UPDATE ON members
FOR EACH ROW EXECUTE FUNCTION block_member_deactivation_if_owns_groups();
