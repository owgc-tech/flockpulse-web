DIP-FP-51 — Fix Infinite Recursion in Members-Subquery RLS Policies
Covers: FP-51 (TECH-DEBT — Infinite recursion in members/attendance RLS policies once get_tenant_id() actually works) Epic: None (deliberately unparented — same reasoning as FP-49/FP-50)
Story Summary
Several RLS policies check the caller's role by running `EXISTS (SELECT 1 FROM members m WHERE m.user_id = auth.uid() ... AND m.role = 'ADMIN' ...)` — a subquery against `members` from within a policy defined on `members` itself (and, transitively, on tables like `attendance` whose policies also subquery `members`). Evaluating the policy requires re-evaluating the policy, recursively, until Postgres raises `42P17`. This was always present; FP-50's fix to `get_tenant_id()` removed the accidental `NULL`-short-circuit that had been masking it. This DIP extracts the role check into its own `SECURITY DEFINER` function — the same pattern already established for `get_tenant_id()` and `block_actions_on_cancelled_or_locked()` — and repoints every affected policy to call it instead of subquerying `members` directly.
Repo Target
Web — `owgc-tech/flockpulse-web`, working branch `dev`.
Grounding Check

1. Full audit required, not just the 2 policies FP-50's sweep surfaced. FP-50's breadth sweep was read-only, so it could only trigger `SELECT`-path recursion (`members_select_admin_all`, and `attendance`'s policies via their own `members` subqueries). The identical anti-pattern exists in write-path policies a read-only sweep structurally cannot reach: `members_insert_admin`, `members_update_admin`, `groups_insert_admin`, `assignments_insert_admin`, `assignments_update_admin` (all in migration `20260629000003`). Audit every policy across every migration for this pattern before assuming the fix list is complete — do not fix only the 5 named here if the audit finds more.
2. Standard, already-proven fix pattern — don't invent a new one. `get_tenant_id()` and `block_actions_on_cancelled_or_locked()` both already demonstrate the correct shape: a `SECURITY DEFINER` function that queries a table directly, bypassing the caller's RLS context entirely, callable from within a policy without triggering that table's own policies again. This DIP creates one new function — e.g. `is_admin_for_tenant()` or similar — following that exact established pattern, not a novel approach.
3. Must not change who is authorized — only how the check avoids recursion. This is a bug-fix DIP, not a permissions-redesign DIP. Every policy's actual authorization logic (which roles can do what) stays identical; only the mechanism for checking role changes. If the audit in item 1 reveals a policy that seems to grant more or less access than intended independent of the recursion bug, flag it — don't silently "fix" it as part of this DIP.
4. Re-verification must cover both read and write paths, unlike FP-50's read-only sweep. Reads: re-run the exact `members`/`attendance` breadth-sweep cases that failed in FP-50. Writes: real `INSERT`/`UPDATE` attempts via an anon-key + JWT client against every policy identified in the audit — this is new test surface, not a rerun of something already built.
5. Out of scope, explicitly: FP-49's original scope-matrix testing (leader-assignment checks, role restrictions, the predicted `attendance_leader_insert` gap). That resumes as its own follow-up once both FP-50 and this ticket are resolved — same discipline as before, don't let three RLS-adjacent DIPs blur into one undifferentiated cleanup effort.
6. No conflicts with Section 4 invariants. Pure bug fix to an enforcement mechanism; no business rule changes.
Implementation Plan

1. Audit every migration for the `EXISTS (SELECT 1 FROM members m WHERE m.user_id = auth.uid() ...)` pattern. Produce the definitive list before writing any fix — confirm it matches or supersedes the 5 named in Grounding Check item 1.
2. Create the `SECURITY DEFINER` role-check function. Something like:

```sql
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

```

Exact naming/signature at CC's discretion, consistent with existing function-naming conventions in this codebase — the point is the mechanism (SECURITY DEFINER bypasses the caller's RLS context when the function itself queries `members`), not the specific name.
3. Repoint every audited policy to call this function instead of its own inline `EXISTS (...)` subquery. `DROP`/`CREATE OR REPLACE` each as needed, preserving identical authorization semantics per Grounding Check item 3.
4. Re-run FP-50's breadth sweep (`members`, `attendance` reads) — confirm `42P17` is gone, confirm legitimate access still works.
5. New write-path tests, one real `INSERT`/`UPDATE` attempt per audited write policy via anon-key + JWT client, confirming no recursion and — as a sanity check — that legitimate admin writes still succeed and non-admin writes are still correctly denied (not just "doesn't crash").
6. Document results in `documentation/test-plans/FP-51-rls-recursion-fix-checklist.md`.
Files to Create/Modify

* `supabase/migrations/20260629000013_fix_rls_recursion.sql` (exact filename/number to be confirmed against whatever's next after FP-50's migration lands)
* `documentation/test-plans/FP-51-rls-recursion-fix-checklist.md`
Migration Files
Not pre-written in this DIP — the exact policy list depends on the audit in Implementation Plan step 1, which must happen first. Do not guess at the full list and write SQL against an assumed set; confirm via the audit, then write the migration.
Branch Name
`feature/FP-51-fix-rls-recursion`
Commit Message
`FP-51: Fix infinite recursion in members-subquery RLS policies via SECURITY DEFINER role-check function`
Pull Request Description
Maps to FP-51's ACs: full audit list, the new function, every repointed policy, FP-50's re-run breadth sweep passing, new write-path test results, and explicit confirmation that FP-49's scope-matrix testing remains untouched/separate.
Jira Linkage

* PDEEpicID: None (deliberately unparented)
* PDEStoryID: FP-51 (TECH-DEBT — Infinite recursion in members/attendance RLS policies)
Stop Point
Save this DIP verbatim to `documentation/dips/DIP-FP-51.md` and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description.
Create the feature branch, run the audit first, get the definitive policy list, then implement. Apply locally, run both the FP-50 re-verification and the new write-path tests, commit, push, and open the PR against `dev`.
Open the PR against dev and stop. Do not merge — the user will check out the branch locally, test it, and merge manually.
Include full diffs for every file in your completion report per Section 5, rule 12 — not a summary.
