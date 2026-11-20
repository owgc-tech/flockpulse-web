-- FP-258: protect the last Administrator, and a read-only list of removal blockers.
--
-- (a) block_last_admin_removal_or_demotion(): a community can never be left with no
--     active Admin-tier member. Refuses removing (deleted_at NULL -> non-NULL) or demoting
--     (role leaves the Admin tier) the last active Admin-tier member of a tenant.
--     SQLSTATE FP409; message LAST_ADMIN (removal) or LAST_ADMIN_DEMOTION (role change).
--     A separate trigger, so remove_member() is NOT modified (FP-254/255/257 will change it).
--     Admin tier = ADMIN, SR_COORDINATOR, COORDINATOR, COMMUNITY_SERVANT (the rank-3 roles in
--     src/lib/auth/middleware.ts); there is no SQL helper for "is Admin tier" (caller_is_admin()
--     is about the calling user, not a row), so the list is written out here, in the trigger and
--     in member_removal_blockers(), and must change with them.
--     The tenant row is locked FOR UPDATE first, so two Admins removing each other at the same
--     moment are serialized and the second one sees the first one's change.
--
-- (b) member_removal_blockers(tenant, member): one read-only row with every reason removal
--     would be refused, so the app can report them all at once. Each count uses EXACTLY the
--     conditions of the latest definition of its guard trigger:
--       assigned_member_count  <- block_member_deactivation_if_assigned_leader() (20261004000079)
--       owned_group_count      <- block_member_deactivation_if_owns_groups()      (20260719000049)
--       owned_event_count      <- block_member_deactivation_if_owns_events()      (20260720000052)
--     THE GUARD TRIGGERS AND THIS FUNCTION MUST ALWAYS CHANGE TOGETHER.
--     A member who does not exist, or is already removed, in that tenant returns zeros and false.
--
-- Idempotent. Existing rows are not touched. FP-228: both functions are closed to
-- PUBLIC / anon / authenticated; member_removal_blockers is granted to service_role only.

-- ==============================================================
-- (a) last-Admin trigger
-- ==============================================================

CREATE OR REPLACE FUNCTION public.block_last_admin_removal_or_demotion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF OLD.deleted_at IS NULL
     AND OLD.role IN ('ADMIN', 'SR_COORDINATOR', 'COORDINATOR', 'COMMUNITY_SERVANT')
     AND (
       NEW.deleted_at IS NOT NULL
       OR NEW.role NOT IN ('ADMIN', 'SR_COORDINATOR', 'COORDINATOR', 'COMMUNITY_SERVANT')
     )
  THEN
    -- Serialize concurrent removals/demotions within one community.
    PERFORM 1 FROM tenants WHERE id = OLD.tenant_id FOR UPDATE;

    IF NOT EXISTS (
      SELECT 1 FROM members m
      WHERE m.tenant_id = OLD.tenant_id
        AND m.id <> OLD.id
        AND m.deleted_at IS NULL
        AND m.role IN ('ADMIN', 'SR_COORDINATOR', 'COORDINATOR', 'COMMUNITY_SERVANT')
    ) THEN
      IF NEW.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'LAST_ADMIN' USING ERRCODE = 'FP409';
      ELSE
        RAISE EXCEPTION 'LAST_ADMIN_DEMOTION' USING ERRCODE = 'FP409';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_block_last_admin_removal_or_demotion ON members;
CREATE TRIGGER trigger_block_last_admin_removal_or_demotion
BEFORE UPDATE OF deleted_at, role ON members
FOR EACH ROW EXECUTE FUNCTION block_last_admin_removal_or_demotion();

REVOKE EXECUTE ON FUNCTION public.block_last_admin_removal_or_demotion() FROM PUBLIC, anon, authenticated;

-- ==============================================================
-- (b) read-only pre-check
-- ==============================================================

CREATE OR REPLACE FUNCTION public.member_removal_blockers(p_tenant_id UUID, p_member_id UUID)
RETURNS TABLE (
  assigned_member_count INT,
  owned_group_count INT,
  owned_event_count INT,
  is_last_admin BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_member members%ROWTYPE;
  v_assigned INT := 0;
  v_groups INT := 0;
  v_events INT := 0;
  v_last BOOLEAN := false;
BEGIN
  SELECT * INTO v_member
  FROM members m
  WHERE m.id = p_member_id AND m.tenant_id = p_tenant_id AND m.deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 0, 0, 0, false;
    RETURN;
  END IF;

  -- same as block_member_deactivation_if_assigned_leader()
  SELECT COUNT(*) INTO v_assigned
  FROM assignments a
  JOIN members m ON m.id = a.member_id AND m.deleted_at IS NULL
  WHERE a.leader_member_id = v_member.id
    AND a.assignment_type = 'LEADER'
    AND a.deleted_at IS NULL;

  -- same as block_member_deactivation_if_owns_groups()
  SELECT COUNT(*) INTO v_groups
  FROM groups g
  WHERE g.owner_member_id = v_member.id AND g.deleted_at IS NULL;

  -- same as block_member_deactivation_if_owns_events()
  SELECT COUNT(*) INTO v_events
  FROM public.get_events_effective_statuses(
    v_member.tenant_id,
    ARRAY(
      SELECT e.id FROM events e
      WHERE e.owner_member_id = v_member.id
        AND e.tenant_id = v_member.tenant_id
        AND e.status != 'CANCELLED'
    )
  ) s
  WHERE s.effective_status NOT IN ('COMPLETED', 'LOCKED');

  -- same rule as block_last_admin_removal_or_demotion()
  IF v_member.role IN ('ADMIN', 'SR_COORDINATOR', 'COORDINATOR', 'COMMUNITY_SERVANT') THEN
    v_last := NOT EXISTS (
      SELECT 1 FROM members m
      WHERE m.tenant_id = v_member.tenant_id
        AND m.id <> v_member.id
        AND m.deleted_at IS NULL
        AND m.role IN ('ADMIN', 'SR_COORDINATOR', 'COORDINATOR', 'COMMUNITY_SERVANT')
    );
  END IF;

  RETURN QUERY SELECT v_assigned, v_groups, v_events, v_last;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.member_removal_blockers(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_removal_blockers(UUID, UUID) TO service_role;
