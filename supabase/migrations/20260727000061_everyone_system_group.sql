-- DIP-FP-181: system-managed "Everyone" group, one per tenant. Every member
-- auto-joins on becoming Active (invite acceptance or founder registration —
-- both generalized via AFTER INSERT ON members, not hardcoded per-function),
-- auto-leaves on deactivation (same transaction, via AFTER UPDATE ON members,
-- mirroring the existing FP-29 guard trigger's own deactivation-transition
-- check). Rename/delete blocked server-side for every role via a trigger on
-- groups itself, not just hidden in the UI. Manual removal blocked while
-- Active via a trigger on assignments, distinguished from the sanctioned
-- deactivation cascade by a transaction-local bypass flag.

-- ==============================================================
-- SECTION 1: schema — system_key marker + one-per-tenant guarantee
-- ==============================================================

ALTER TABLE groups ADD COLUMN IF NOT EXISTS system_key TEXT;

ALTER TABLE groups DROP CONSTRAINT IF EXISTS groups_system_key_check;
ALTER TABLE groups
    ADD CONSTRAINT groups_system_key_check
    CHECK (system_key IS NULL OR system_key = 'EVERYONE');

CREATE UNIQUE INDEX IF NOT EXISTS idx_groups_unique_system_key_per_tenant
    ON groups(tenant_id, system_key)
    WHERE system_key IS NOT NULL AND deleted_at IS NULL;


-- ==============================================================
-- SECTION 2: backfill — one Everyone group per existing tenant,
-- then every currently-Active member into it. Both idempotent.
-- ==============================================================

INSERT INTO groups (tenant_id, name, system_key, created_by)
SELECT t.id, 'Everyone', 'EVERYONE', NULL
FROM tenants t
WHERE NOT EXISTS (
    SELECT 1 FROM groups g WHERE g.tenant_id = t.id AND g.system_key = 'EVERYONE'
);

INSERT INTO assignments (tenant_id, member_id, group_id, assignment_type)
SELECT m.tenant_id, m.id, g.id, 'GROUP'
FROM members m
JOIN groups g ON g.tenant_id = m.tenant_id AND g.system_key = 'EVERYONE' AND g.deleted_at IS NULL
WHERE m.deleted_at IS NULL
ON CONFLICT (member_id, group_id) WHERE deleted_at IS NULL AND assignment_type = 'GROUP'
DO NOTHING;


-- ==============================================================
-- SECTION 3: new tenants get an Everyone group automatically
-- ==============================================================

CREATE OR REPLACE FUNCTION public.create_everyone_group_for_new_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  INSERT INTO groups (tenant_id, name, system_key, created_by)
  VALUES (NEW.id, 'Everyone', 'EVERYONE', NULL);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_create_everyone_group_for_new_tenant ON tenants;
CREATE TRIGGER trigger_create_everyone_group_for_new_tenant
AFTER INSERT ON tenants
FOR EACH ROW EXECUTE FUNCTION create_everyone_group_for_new_tenant();


-- ==============================================================
-- SECTION 4: new members auto-join their tenant's Everyone group
-- ==============================================================

CREATE OR REPLACE FUNCTION public.add_new_member_to_everyone_group()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE v_everyone_group_id UUID;
BEGIN
  IF NEW.deleted_at IS NULL THEN
    SELECT id INTO v_everyone_group_id
    FROM groups WHERE tenant_id = NEW.tenant_id AND system_key = 'EVERYONE' AND deleted_at IS NULL;

    IF v_everyone_group_id IS NOT NULL THEN
      INSERT INTO assignments (tenant_id, member_id, group_id, assignment_type)
      VALUES (NEW.tenant_id, NEW.id, v_everyone_group_id, 'GROUP')
      ON CONFLICT (member_id, group_id) WHERE deleted_at IS NULL AND assignment_type = 'GROUP'
      DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_add_new_member_to_everyone_group ON members;
CREATE TRIGGER trigger_add_new_member_to_everyone_group
AFTER INSERT ON members
FOR EACH ROW EXECUTE FUNCTION add_new_member_to_everyone_group();


-- ==============================================================
-- SECTION 5: deactivation removes the member from Everyone,
-- same transaction as softDeleteMember's own UPDATE.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.remove_member_from_everyone_group_on_deactivation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    PERFORM set_config('app.bypass_system_group_guard', 'true', true);

    UPDATE assignments
    SET deleted_at = now()
    WHERE assignments.tenant_id = NEW.tenant_id
      AND assignments.member_id = NEW.id
      AND assignments.assignment_type = 'GROUP'
      AND assignments.deleted_at IS NULL
      AND EXISTS (
        SELECT 1 FROM groups g
        WHERE g.id = assignments.group_id AND g.system_key = 'EVERYONE'
      );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_remove_member_from_everyone_group_on_deactivation ON members;
CREATE TRIGGER trigger_remove_member_from_everyone_group_on_deactivation
AFTER UPDATE ON members
FOR EACH ROW EXECUTE FUNCTION remove_member_from_everyone_group_on_deactivation();


-- ==============================================================
-- SECTION 6: block manual removal from a system group while Active
-- — distinguished from the sanctioned cascade above via the
-- transaction-local bypass flag it sets immediately before its write.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.block_manual_removal_from_system_group()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE v_is_system BOOLEAN;
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL AND NEW.assignment_type = 'GROUP' THEN
    IF current_setting('app.bypass_system_group_guard', true) IS DISTINCT FROM 'true' THEN
      SELECT (system_key IS NOT NULL) INTO v_is_system FROM groups WHERE id = NEW.group_id;
      IF v_is_system THEN
        RAISE EXCEPTION 'SYSTEM_MANAGED_GROUP: cannot remove a member from a system-managed group while active';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_block_manual_removal_from_system_group ON assignments;
CREATE TRIGGER trigger_block_manual_removal_from_system_group
BEFORE UPDATE ON assignments
FOR EACH ROW EXECUTE FUNCTION block_manual_removal_from_system_group();


-- ==============================================================
-- SECTION 7: block rename/delete of a system group, any role, any path
-- ==============================================================

CREATE OR REPLACE FUNCTION public.block_system_group_rename_or_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF OLD.system_key IS NOT NULL THEN
    IF NEW.name IS DISTINCT FROM OLD.name THEN
      RAISE EXCEPTION 'SYSTEM_MANAGED_GROUP: cannot rename or delete a system-managed group';
    END IF;
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
      RAISE EXCEPTION 'SYSTEM_MANAGED_GROUP: cannot rename or delete a system-managed group';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_block_system_group_rename_or_delete ON groups;
CREATE TRIGGER trigger_block_system_group_rename_or_delete
BEFORE UPDATE ON groups
FOR EACH ROW EXECUTE FUNCTION block_system_group_rename_or_delete();
