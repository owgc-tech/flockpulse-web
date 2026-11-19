-- FP-52: attendance_leader_insert's WITH CHECK verified caller role but never checked
-- whether the target member is actually in the caller's assignments set. A leader could
-- insert leader_confirm/leader_reject attendance for any member in their tenant, not just
-- their own assigned members. Confirmed empirically in FP-49.
--
-- Fix: new caller_is_leader_for_member(p_member_id) SECURITY DEFINER function checks
-- whether the caller has an active LEADER assignment to the given member. The policy
-- is updated to require EITHER caller_is_admin() OR caller_is_leader_for_member(member_id),
-- preserving the additive-RBAC invariant (Admin ⊇ Leader, STORY-6.2).
--
-- Note on the Admin bypass: the normal confirm/reject flow (app/api/confirmations/[selfReportId])
-- calls resolve_leader_confirmation() which is itself SECURITY DEFINER and bypasses RLS
-- entirely, so the admin bypass here is a defense-in-depth guard for direct DB access
-- and future API paths — it does not affect the currently-shipped confirm flow.

CREATE OR REPLACE FUNCTION public.caller_is_leader_for_member(p_member_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM assignments a
    WHERE a.member_id = p_member_id
      AND a.assignment_type = 'LEADER'
      AND a.tenant_id = get_tenant_id()
      AND a.deleted_at IS NULL
      AND a.leader_member_id IN (
        SELECT m.id FROM members m
        WHERE m.user_id = auth.uid()
          AND m.tenant_id = get_tenant_id()
          AND m.deleted_at IS NULL
      )
  );
$$;

DROP POLICY IF EXISTS "attendance_leader_insert" ON attendance;
CREATE POLICY "attendance_leader_insert" ON attendance
    FOR INSERT
    WITH CHECK (
        tenant_id = get_tenant_id()
        AND confirmation_type IN ('leader_confirm', 'leader_reject')
        AND caller_member_is_leader_or_admin(confirmed_by)
        AND (caller_is_admin() OR caller_is_leader_for_member(member_id))
    );
