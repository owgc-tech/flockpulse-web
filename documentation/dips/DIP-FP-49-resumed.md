DIP-FP-49 (Resumed) — Cross-Tenant Isolation, Leader Scope, and Admin Override RLS Verification

**Covers:** FP-49 (VERIFICATION — Confirm RLS policies actually enforce tenant/scope isolation via direct Supabase access)
**Epic:** None (deliberately unparented — spans EPIC-4/5/6 tables)

---

## Story Summary

FP-49 originally opened to prove RLS is a genuine backstop, not just correctly-written-but-untested SQL. Its own groundwork surfaced FP-50 (`get_tenant_id()` reading the wrong JWT path) and FP-51 (resulting policy recursion), both now fixed, merged, and confirmed on `fpdb-dev`. FP-51's own verification, built to prove its recursion fix, happened to exercise a real chunk of FP-49's original scope as a side effect: self-ownership checks on `rsvps` and `member_attendance_reports` (own row succeeds, another member's row denied), and admin-vs-non-admin checks on `members`, `groups`, `assignments`. That ground does not need to be re-tested.

**What's confirmed still open, precisely, per this session's explicit framing:**
1. **Cross-tenant isolation** — a member/leader in Community A cannot read or write anything belonging to Community B, on any table. FP-51 tested cross-*member* isolation within one tenant; it never tested cross-*tenant* isolation at all.
2. **Leader scope on `attendance`** — a leader confirming their own assigned member succeeds; the same leader attempting to confirm a member **not** in their `assignments` is denied. This is the specific gap predicted in the original DIP-FP-49 and never yet tested — `attendance_leader_insert` was explicitly excluded from FP-51's scope because it requires an open event + pending self-report fixture.
3. **Admin override, unrestricted within tenant** — an Admin can set attendance for any member in their own tenant regardless of which leader that member is normally assigned to; the same Admin has zero access to another tenant's data. `attendance_admin_upsert` was also explicitly excluded from FP-51.

These three map directly to positions the user stated explicitly this session: *"there cannot be any data interaction between tenants... Pastoral Leaders have access to their members, approving their members only... Admins should be allowed to confirm member's attendance regardless which leader they are under."* Confirmed against the PDD and STORY-6.2/6.4 acceptance criteria — no conflict, this DIP tests exactly what's already specified.

---

## Repo Target

**Web — `owgc-tech/flockpulse-web`**, working branch `dev`.

---

## Grounding Check

1. **Reuse FP-51's test infrastructure, don't rebuild it.** The anon-key + JWT client helper, the real-Supabase-Auth-user fixture pattern, and the `psql`-based fixture setup for tables PostgREST can't easily seed through — all already exist and are proven working in FP-51's script. Extend that pattern; don't reinvent it.

2. **Two-tenant fixture is new territory — nothing this session has tested cross-tenant isolation with two real, separate tenants and two real, separate authenticated users.** Every fixture so far (FP-51 included) used a single test tenant. This DIP needs Tenant A and Tenant B, each with their own member(s), to actually prove isolation rather than infer it.

3. **`attendance_leader_insert` and `attendance_admin_upsert` require real event + self-report fixtures** — an event in `COMPLETED` status, a `member_attendance_reports` row at `PENDING_CONFIRMATION`, an `assignments` row linking one leader to one member. FP-51 explicitly deferred this exact fixture complexity; build it now.

4. **The predicted gap (item 2) is the most important single test in this DIP.** If `attendance_leader_insert`'s `WITH CHECK` only verifies `confirmed_by` resolves to a caller with role `LEADER`/`ADMIN` — via `caller_member_is_leader_or_admin()`, per FP-51's migration — and never checks whether the *target member* (the row's `member_id`) is in that leader's `assignments` set, then a leader can insert an `ATTENDED` row for **any** member in their tenant, not just their own. Re-confirm this by reading the actual current policy body before writing the test, not from memory of the DIP-FP-51 diff — confirm it's still exactly as FP-51 left it.

5. **No conflicts with Section 4 invariants or the PDD.** This tests existing, specified behavior — additive RBAC, tenant isolation, leader-scoped confirmation, admin-unrestricted-within-tenant override. Confirmed against PDD Section 2 (role capabilities) and STORY-6.2/6.4 ACs this session, directly with the user.

6. **If any test fails: stop, do not patch inline, file a tech-debt ticket per the standard Background/Risk/AC/Source template, report back.** Same protocol as the original DIP-FP-49 and both its offspring (FP-50, FP-51) — this has proven itself three times running; no reason to abandon it now.

---

## Implementation Plan

1. **Cross-tenant fixtures:** create two real Supabase Auth users in two different tenants (Tenant A, Tenant B), each with a matching `members` row. Using Tenant A's authenticated client, attempt to `SELECT` a Tenant B `rsvps` row and a Tenant B `member_attendance_reports` row directly by ID — expect `0` rows returned (RLS-filtered, not an error) for both. Attempt an `INSERT` into `rsvps` under Tenant B's `tenant_id` while authenticated as a Tenant A user — expect denial.

2. **Leader-scope fixture:** one tenant, two members (Member A, Member B), one leader assigned to Member A only (`assignments`, `assignment_type = 'LEADER'`). One event in `COMPLETED` status. One `member_attendance_reports` row for Member A at `PENDING_CONFIRMATION`, one for Member B at `PENDING_CONFIRMATION`.
   - Leader, authenticated via anon-key + JWT, attempts `INSERT` into `attendance` with `confirmation_type = 'leader_confirm'`, `confirmed_by` = their own member id, targeting **Member A** (their assigned member) — expect success.
   - Same leader attempts the identical `INSERT` targeting **Member B** (not assigned to them) — expect denial. **This is the test that resolves the original prediction.**

3. **Admin-override fixture:** same tenant, an Admin member. Admin attempts `INSERT`/upsert into `attendance` with `confirmation_type = 'admin_override'` targeting Member B (not their own assignment — admins have none) — expect success, since admin is unrestricted within their own tenant. Admin authenticated in Tenant A attempts the same against a Tenant B member — expect denial (cross-tenant, covered by item 1's mechanism but worth confirming at this specific policy too).

4. **Document every test and result** in `documentation/test-plans/rls-verification-checklist.md` (the file FP-49's original AC named) — create it now if FP-51 didn't already, or extend it if a version exists.

5. **If the leader-scope test in step 2 confirms the predicted gap:** stop, do not fix inline. File a new tech-debt ticket (standard Background/Risk/AC/Source template) describing the exact gap in `attendance_leader_insert` and proposing the fix (add an assignment-scope check, likely via a new or extended `SECURITY DEFINER` function checking `assignments` for the specific leader→member pair). A separate DIP handles the fix, same pattern as FP-50→FP-51.

---

## Files to Create/Modify

- `documentation/test-plans/rls-verification-checklist.md` (create or extend)
- Test script follows the established `scripts/` convention (gitignored, dev-tool-only)

## Migration Files

None expected. If step 5 finds the predicted gap, the fix is separate, later work — not part of this DIP.

---

## Branch Name

`feature/FP-49-cross-tenant-and-scope-verification`

---

## Commit Message

`FP-49: Verify cross-tenant isolation, leader scope, and admin override via real anon-key + JWT requests`

---

## Pull Request Description

Maps to the three items in Story Summary: cross-tenant isolation results, leader-scope result (including whether the predicted gap was confirmed), admin-override result. If the predicted gap was found: states clearly that a follow-up tech-debt ticket has been filed and this PR does not attempt the fix, per Grounding Check item 6.

---

## Jira Linkage

- PDEEpicID: None (deliberately unparented)
- PDEStoryID: FP-49 (VERIFICATION — Confirm RLS policies actually enforce tenant/scope isolation)

---

## Stop Point

Save this DIP verbatim to `documentation/dips/DIP-FP-49-resumed.md` and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description.

Create the feature branch off `dev`, build the two-tenant and leader/event fixtures, run all tests, document results, commit, push, and open the PR against `dev`.

**If the predicted leader-scope gap is confirmed: stop, file the tech-debt ticket, do not fix inline, report back before proceeding further.**

**Open the PR against dev and stop. Do not merge — the user will check out the branch locally, test it, and merge manually.**

Include full diffs for every file in your completion report per Section 5, rule 12 — not a summary.
