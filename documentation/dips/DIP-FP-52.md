DIP-FP-52 — Add Assignment-Scope Check to attendance_leader_insert
Covers: FP-52 (TECH-DEBT — attendance_leader_insert RLS policy does not enforce leader assignment scope) Epic: None (deliberately unparented — same reasoning as FP-49/50/51)
Story Summary
`attendance_leader_insert`'s `WITH CHECK` verifies the caller holds `LEADER`/`ADMIN` role and that `confirmed_by` maps to their own member record — but never checks whether the row's `member_id` (the member being confirmed) is actually in that leader's `assignments` set. Confirmed empirically in FP-49: a leader successfully inserted a `leader_confirm` row for a member they had no assignment to. This DIP adds the missing scope check via a new `SECURITY DEFINER` function, `caller_is_leader_for_member()`, following the same pattern as every other role-check function in this schema.
Repo Target
Web — `owgc-tech/flockpulse-web`, working branch `dev`.
Grounding Check

1. The fix must not regress Admin's existing use of this same policy. Tracing `confirmation.service.ts`: when an Admin confirms/rejects via the normal `/api/confirmations` endpoint (not `/api/attendance/override`), `resolve_leader_confirmation()` still writes `confirmation_type = 'leader_confirm'`/`'leader_reject'` — identical to a Leader doing it, per the additive-RBAC design from STORY-6.2 (Admin ⊇ Leader). Admins go through `attendance_leader_insert` for this action today, not exclusively `attendance_admin_upsert`. The new check must be `caller_is_admin() OR caller_is_leader_for_member(member_id)`, not a straight replacement of the existing role check. A straight replacement would deny an Admin confirming a member they have no `assignments` row for — breaking already-shipped, already-tested FP-23 behavior. Confirm this reasoning against the live `confirmation.service.ts` before implementing, don't take it on faith from this DIP alone.
2. Route path discrepancy in the ticket needs a one-line confirmation, not silent trust. FP-52's Background section cites `app/api/attendance/leader/route.ts`. The actual route from FP-23 is `app/api/confirmations/[selfReportId]/route.ts`. Confirm which is correct — either the ticket has a minor factual error worth a quick correction, or a second route exists that wasn't previously tracked. Resolve this before writing the PR description that references it.
3. New function follows the exact established pattern — `LANGUAGE sql`, `STABLE`, `SECURITY DEFINER`, `SET search_path = public, pg_catalog` — matching `get_tenant_id()`, `caller_is_admin()`, `caller_owns_member()`, `caller_member_is_leader_or_admin()`. Single-purpose: this function only answers "is the caller assigned as this member's leader" — role gating (`LEADER`/`ADMIN`) stays in the existing `caller_member_is_leader_or_admin(confirmed_by)` check, don't duplicate it.
4. `assignments` join must be tenant-scoped and exclude soft-deleted rows — `assignment_type = 'LEADER'`, `deleted_at IS NULL`, `tenant_id = get_tenant_id()` on the assignment itself, matching every other `assignments` query in this codebase (`getAssignedMemberIds()` in `confirmation.repository.ts` uses the identical filter set).
5. All 18 FP-51 tests must still pass, plus FP-49's 7 previously-passing tests, plus this DIP's new tests. This is a policy edit on a table three separate stories already depend on — full regression, not just the new case.
6. New required test, not in FP-52's original AC as written: confirm an Admin can still insert `leader_confirm`/`leader_reject` attendance for a member outside their own assignments (admins have none) — this is the regression case from Grounding Check item 1, and it's not explicitly listed in the ticket's AC. Add it; don't rely solely on the ticket's stated acceptance criteria.
7. No conflicts with Section 4 invariants or the PDD. This closes the exact gap between the RLS backstop and the already-correct, already-specified business rule (STORY-6.2: leader confirms only assigned members; Admin unrestricted within tenant).
Implementation Plan

1. Migration: create `caller_is_leader_for_member(p_member_id UUID)`:

```sql
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

```

2. Rewrite `attendance_leader_insert`:

```sql
DROP POLICY IF EXISTS "attendance_leader_insert" ON attendance;
CREATE POLICY "attendance_leader_insert" ON attendance
    FOR INSERT
    WITH CHECK (
        tenant_id = get_tenant_id()
        AND confirmation_type IN ('leader_confirm', 'leader_reject')
        AND caller_member_is_leader_or_admin(confirmed_by)
        AND (caller_is_admin() OR caller_is_leader_for_member(member_id))
    );

```

Note the composition: `caller_member_is_leader_or_admin(confirmed_by)` still establishes that `confirmed_by` is the caller's own identity and that they hold a qualifying role. The new clause adds the scope restriction on top, with the Admin bypass preserving existing behavior.
3. Re-run all 18 FP-51 tests — confirm no regression from the policy edit.
4. Re-run FP-49's leader-scope tests (2.1, 2.2 from the FP-49 branch) — 2.1 (assigned member) should still pass; 2.2 (non-assigned member) should now correctly deny instead of the previously-confirmed gap.
5. New test (Grounding Check item 6): Admin inserts `leader_confirm` for a member with no `assignments` link to that Admin — confirm this still succeeds.
6. Document all results in the FP-49 checklist doc, updating the FP-52 gap's status from "confirmed" to "fixed and re-verified."
Files to Create/Modify

* `supabase/migrations/20260629000014_fix_attendance_leader_scope.sql`
* `documentation/test-plans/rls-verification-checklist.md` (update FP-52 finding's status)
Migration File
`supabase/migrations/20260629000014_fix_attendance_leader_scope.sql`

```sql
-- FP-52: attendance_leader_insert's WITH CHECK verified caller role but never checked
-- whether the target member is actually in the caller's assignments set. A leader could
-- insert leader_confirm/leader_reject attendance for any member in their tenant, not just
-- their own assigned members. Confirmed empirically in FP-49.
--
-- Fix preserves Admin's existing ability to use this same policy path (not just
-- attendance_admin_upsert) — Admin confirming via the normal confirm/reject flow still
-- writes confirmation_type = 'leader_confirm', per additive RBAC (STORY-6.2). The new
-- scope check is OR'd with an admin bypass, not a straight replacement.

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

```

Branch Name
`feature/FP-52-fix-attendance-leader-scope`
Commit Message
`FP-52: Add assignment-scope check to attendance_leader_insert RLS policy`
Pull Request Description
Maps to FP-52's ACs plus the added regression test from Grounding Check item 6. States clearly whether the `app/api/attendance/leader/route.ts` vs. `app/api/confirmations/[selfReportId]/route.ts` discrepancy was a ticket error or a real second route, per Grounding Check item 2.
Jira Linkage

* PDEEpicID: None (deliberately unparented)
* PDEStoryID: FP-52 (TECH-DEBT — attendance_leader_insert RLS policy does not enforce leader assignment scope)
Stop Point
Save this DIP verbatim to `documentation/dips/DIP-FP-52.md` and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description.
Create the feature branch off `dev`, confirm the route-path discrepancy first, implement, run the full regression (18 FP-51 tests + FP-49's 2.1/2.2 + the new Admin-bypass test), commit, push, and open the PR against `dev`.
Open the PR against dev and stop. Do not merge — the user will check out the branch locally, test it, and merge manually.
Include full diffs for every file in your completion report per Section 5, rule 12 — not a summary.
