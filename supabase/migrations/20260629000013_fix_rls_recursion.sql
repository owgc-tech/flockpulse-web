-- FP-51: Fix infinite recursion in members-subquery RLS policies.
--
-- Root cause: several policies do EXISTS (SELECT 1 FROM members ...) to check
-- the caller's role. When evaluating those policies on the members table itself
-- (members_select_admin_all, members_insert_admin, members_update_admin),
-- Postgres builds the combined policy predicate as:
--   (policy1_using) OR (policy2_using)
-- Evaluating policy2's EXISTS re-enters members' own policies → 42P17.
-- Policies on other tables (groups, assignments, rsvps, member_attendance_reports,
-- attendance) are also affected because their members subqueries trigger the same
-- recursive members policy evaluation.
--
-- This was always present; FP-50 (000012) removed the accidental NULL-short-circuit
-- that was masking it — once get_tenant_id() returns a real UUID, the EXISTS fires
-- and the recursion surfaces.
--
-- Fix: extract each subquery pattern into a SECURITY DEFINER function. Functions
-- with SECURITY DEFINER run as the definer (postgres), bypassing the caller's RLS
-- context — the same pattern used by get_tenant_id() and
-- block_actions_on_cancelled_or_locked(). The members query inside the function
-- does not trigger the caller's RLS stack, breaking the recursion.
--
-- Full audit — 11 policies across 5 migrations, 3 distinct check patterns:
--   1. Admin check (caller_is_admin):
--      members_select_admin_all, members_insert_admin, members_update_admin,
--      groups_insert_admin, assignments_insert_admin, assignments_update_admin,
--      attendance_admin_upsert
--   2. Self-member check (caller_owns_member):
--      rsvps_insert_self, rsvps_update_self, self_reports_insert_self
--   3. Leader/admin on specific member id (caller_member_is_leader_or_admin):
--      attendance_leader_insert (checks confirmed_by maps to caller's LEADER/ADMIN member)
--
-- No authorization logic changes — only the mechanism for the check.
-- ==============================================================


-- ==============================================================
-- SECTION 1: SECURITY DEFINER helper functions
-- ==============================================================

-- caller_is_admin(): true iff auth.uid() maps to an ADMIN member in the caller's tenant.
CREATE OR REPLACE FUNCTION public.caller_is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM members m
    WHERE m.user_id = auth.uid()
      AND m.tenant_id = get_tenant_id()
      AND m.role = 'ADMIN'
      AND m.deleted_at IS NULL
  );
$$;

-- caller_owns_member(p_member_id): true iff p_member_id is a members row
-- whose user_id = auth.uid(), in the caller's tenant, and not soft-deleted.
CREATE OR REPLACE FUNCTION public.caller_owns_member(p_member_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM members m
    WHERE m.id = p_member_id
      AND m.user_id = auth.uid()
      AND m.tenant_id = get_tenant_id()
      AND m.deleted_at IS NULL
  );
$$;

-- caller_member_is_leader_or_admin(p_member_id): true iff p_member_id is a members
-- row whose user_id = auth.uid() AND whose role is LEADER or ADMIN, in the caller's
-- tenant. Used by attendance_leader_insert to confirm that confirmed_by is the caller's
-- own member record and that caller has the required role.
CREATE OR REPLACE FUNCTION public.caller_member_is_leader_or_admin(p_member_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM members m
    WHERE m.id = p_member_id
      AND m.user_id = auth.uid()
      AND m.tenant_id = get_tenant_id()
      AND m.role IN ('LEADER', 'ADMIN')
      AND m.deleted_at IS NULL
  );
$$;


-- ==============================================================
-- SECTION 2: members policies (originally in 000003)
-- ==============================================================

DROP POLICY IF EXISTS "members_select_admin_all" ON members;
CREATE POLICY "members_select_admin_all" ON members
    FOR SELECT
    USING (
        tenant_id = get_tenant_id()
        AND caller_is_admin()
    );

DROP POLICY IF EXISTS "members_insert_admin" ON members;
CREATE POLICY "members_insert_admin" ON members
    FOR INSERT
    WITH CHECK (
        tenant_id = get_tenant_id()
        AND caller_is_admin()
    );

DROP POLICY IF EXISTS "members_update_admin" ON members;
CREATE POLICY "members_update_admin" ON members
    FOR UPDATE
    USING (
        tenant_id = get_tenant_id()
        AND caller_is_admin()
    )
    WITH CHECK (tenant_id = get_tenant_id());


-- ==============================================================
-- SECTION 3: groups policy (originally in 000003)
-- ==============================================================

DROP POLICY IF EXISTS "groups_insert_admin" ON groups;
CREATE POLICY "groups_insert_admin" ON groups
    FOR INSERT
    WITH CHECK (
        tenant_id = get_tenant_id()
        AND caller_is_admin()
    );


-- ==============================================================
-- SECTION 4: assignments policies (originally in 000003)
-- ==============================================================

DROP POLICY IF EXISTS "assignments_insert_admin" ON assignments;
CREATE POLICY "assignments_insert_admin" ON assignments
    FOR INSERT
    WITH CHECK (
        tenant_id = get_tenant_id()
        AND caller_is_admin()
    );

DROP POLICY IF EXISTS "assignments_update_admin" ON assignments;
CREATE POLICY "assignments_update_admin" ON assignments
    FOR UPDATE
    USING (
        tenant_id = get_tenant_id()
        AND caller_is_admin()
    )
    WITH CHECK (tenant_id = get_tenant_id());


-- ==============================================================
-- SECTION 5: rsvps policies (originally in 000007)
-- ==============================================================

DROP POLICY IF EXISTS "rsvps_insert_self" ON rsvps;
CREATE POLICY "rsvps_insert_self" ON rsvps
    FOR INSERT
    WITH CHECK (
        tenant_id = get_tenant_id()
        AND caller_owns_member(member_id)
    );

DROP POLICY IF EXISTS "rsvps_update_self" ON rsvps;
CREATE POLICY "rsvps_update_self" ON rsvps
    FOR UPDATE
    USING (
        tenant_id = get_tenant_id()
        AND caller_owns_member(member_id)
    )
    WITH CHECK (tenant_id = get_tenant_id());


-- ==============================================================
-- SECTION 6: member_attendance_reports policy (originally in 000008)
-- ==============================================================

DROP POLICY IF EXISTS "self_reports_insert_self" ON member_attendance_reports;
CREATE POLICY "self_reports_insert_self" ON member_attendance_reports
    FOR INSERT
    WITH CHECK (
        tenant_id = get_tenant_id()
        AND caller_owns_member(member_id)
    );


-- ==============================================================
-- SECTION 7: attendance policies (originally in 000010)
-- ==============================================================

DROP POLICY IF EXISTS "attendance_leader_insert" ON attendance;
CREATE POLICY "attendance_leader_insert" ON attendance
    FOR INSERT
    WITH CHECK (
        tenant_id = get_tenant_id()
        AND confirmation_type IN ('leader_confirm', 'leader_reject')
        AND caller_member_is_leader_or_admin(confirmed_by)
    );

DROP POLICY IF EXISTS "attendance_admin_upsert" ON attendance;
CREATE POLICY "attendance_admin_upsert" ON attendance
    FOR ALL
    USING (
        tenant_id = get_tenant_id()
        AND caller_is_admin()
    )
    WITH CHECK (tenant_id = get_tenant_id() AND confirmation_type = 'admin_override');
