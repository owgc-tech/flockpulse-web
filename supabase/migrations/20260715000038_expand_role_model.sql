-- DIP-FP-113-web: expand role model — Admin-tier synonyms (SR_COORDINATOR,
-- COORDINATOR, COMMUNITY_SERVANT) + Leader-tier synonym (PASTORAL_LEADER),
-- permanently coexisting with ADMIN/LEADER, identical access within tier.
--
-- Confirmed live before writing this (full local grep audit — GitHub API was
-- rate-limited during this DIP's own grounding pass, see Grounding Check —
-- so this migration is grounded in a local grep of every migration file,
-- not the DIP's partial findings):
--   - members.role and invitations.role are both TEXT + inline CHECK
--     constraints (role IN ('ADMIN','LEADER','MEMBER')), not native ENUMs —
--     matches every other enum-like column in this schema (gender,
--     marital_status, self_report_status). Widened the same way
--     20260708000027_widen_marital_status.sql widened marital_status.
--   - Constraint names are NOT hardcoded here, unlike that precedent — this
--     DIP could not run `supabase db reset` locally to confirm the exact
--     auto-generated constraint names before writing this (Docker
--     unavailable in the execution sandbox), so both DROPs below look the
--     constraint up dynamically via pg_constraint instead of assuming
--     `members_role_check`/`invitations_role_check` by convention. Guessing
--     wrong and silently leaving a duplicate, narrower constraint active
--     would be a much worse failure mode than the extra few lines here.
--   - RLS already centralizes admin / leader-or-admin checks in two
--     SECURITY DEFINER functions — caller_is_admin() and
--     caller_member_is_leader_or_admin(), both added in
--     20260629000013_fix_rls_recursion.sql. 8 policies across members/
--     groups/assignments/attendance/invitations already call these rather
--     than inlining `m.role = 'ADMIN'`. Widening the two functions' bodies
--     here fixes all 8 policies for free — no policy rewrites needed for
--     them, and this DIP does NOT introduce new is_admin_tier()/
--     is_leader_tier_or_above() functions as originally planned, since
--     that would duplicate/orphan this already-established pattern.
--   - Two policies do not go through the shared functions and still inline
--     the literal comparison directly: groups_select_admin_all and
--     groups_update_admin, added later in
--     20260713000036_groups_full_crud_audit.sql (whose own header comment
--     notes "caller_is_admin() exists... used elsewhere" but didn't use it
--     for these two). Rewritten below to call caller_is_admin() instead,
--     consolidating them into the single-source-of-truth pattern rather
--     than leaving a second literal to maintain.
--   - Six more `m.role = 'ADMIN'` / `m.role IN ('LEADER','ADMIN')` literals
--     exist in migration history (20260629000003 ×5 relevant, plus
--     20260629000010 ×2) but are dead: every policy they originally defined
--     was DROPped and re-CREATEd by a later migration (20260629000013 or
--     20260629000014) using the shared functions instead. Left untouched —
--     migrations are immutable history, and the live policy definitions are
--     already covered by the function widening above.
--   - `assignment_type = 'LEADER'` (assignments table) and the
--     set_member_pastoral_leader() RPC / "Pastoral Leader" terminology in
--     20260712000035 are a pre-existing, UNRELATED concept — an assignment
--     relationship (who is this member's leader), not a member's own role.
--     Deliberately not touched here; flagged as a naming collision worth
--     knowing about, not a bug.
--
-- See the PR description for the full grep output this is grounded in, and
-- for two TypeScript-layer bugs found in the same audit that this SQL
-- doesn't touch: app/api/formation/progress/route.ts and
-- app/api/events/[id]/roster/route.ts both did an exact `ctx.role ===
-- 'LEADER'` comparison for RBAC *scoping* (not gating), which would let a
-- PASTORAL_LEADER account fall through to Admin-unscoped access. Fixed in
-- the same commit via a new rank-based isExactlyLeaderTier() helper in
-- middleware.ts, not a literal-widening — a SQL migration can't fix that.

-- ==============================================================
-- SECTION 1: widen members.role and invitations.role CHECK constraints
-- ==============================================================

DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  SELECT con.conname INTO v_constraint_name
  FROM pg_constraint con
  JOIN pg_attribute att
    ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
  WHERE con.conrelid = 'members'::regclass
    AND con.contype = 'c'
    AND att.attname = 'role';

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE members DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END $$;

ALTER TABLE members
  ADD CONSTRAINT members_role_check
  CHECK (role IN ('ADMIN', 'LEADER', 'MEMBER', 'SR_COORDINATOR', 'COORDINATOR', 'COMMUNITY_SERVANT', 'PASTORAL_LEADER'));

DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  SELECT con.conname INTO v_constraint_name
  FROM pg_constraint con
  JOIN pg_attribute att
    ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
  WHERE con.conrelid = 'invitations'::regclass
    AND con.contype = 'c'
    AND att.attname = 'role';

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE invitations DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END $$;

ALTER TABLE invitations
  ADD CONSTRAINT invitations_role_check
  CHECK (role IN ('ADMIN', 'LEADER', 'MEMBER', 'SR_COORDINATOR', 'COORDINATOR', 'COMMUNITY_SERVANT', 'PASTORAL_LEADER'));


-- ==============================================================
-- SECTION 2: widen the shared RLS rank-check functions.
-- caller_is_admin() and caller_member_is_leader_or_admin() are called by
-- 8 existing policies across members/groups/assignments/attendance/
-- invitations — widening their bodies fixes all of them, no policy
-- rewrites needed for those 8.
-- ==============================================================

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
      AND m.role IN ('ADMIN', 'SR_COORDINATOR', 'COORDINATOR', 'COMMUNITY_SERVANT')
      AND m.deleted_at IS NULL
  );
$$;

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
      AND m.role IN ('LEADER', 'PASTORAL_LEADER', 'ADMIN', 'SR_COORDINATOR', 'COORDINATOR', 'COMMUNITY_SERVANT')
      AND m.deleted_at IS NULL
  );
$$;


-- ==============================================================
-- SECTION 3: consolidate the two groups policies that still inline the
-- literal comparison instead of calling caller_is_admin().
-- ==============================================================

DROP POLICY IF EXISTS "groups_select_admin_all" ON groups;
CREATE POLICY "groups_select_admin_all" ON groups
  FOR SELECT USING (
    tenant_id = get_tenant_id()
    AND caller_is_admin()
  );

DROP POLICY IF EXISTS "groups_update_admin" ON groups;
CREATE POLICY "groups_update_admin" ON groups
  FOR UPDATE
  USING (
    tenant_id = get_tenant_id()
    AND caller_is_admin()
  )
  WITH CHECK (tenant_id = get_tenant_id());
