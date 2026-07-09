Grounded and ready. Two things surfaced during drafting that change the DIP materially — flagging before the document itself:

1. Real cross-tenant gap, live-confirmed: `assignments.group_id` and `assignments.leader_member_id` are bare FKs with no `BEFORE INSERT/UPDATE` trigger validating same-tenant membership (confirmed in `20260629000003_remediate_rbac_and_assignments.sql` — the migration added the columns and partial unique indexes but never added the Section-4-mandated trigger). FP-72 is the first story to let an Admin write a `LEADER` assignment through the UI, so this DIP closes that gap rather than deferring it.
2. A second, more subtle gap: the partial unique index `idx_assignments_unique_active_leader` is `(member_id, leader_member_id)` — it only blocks duplicating the same leader twice. Nothing in the schema stops a member from having two different active `LEADER` assignments simultaneously, even though the product model (and FP-72's singular "Pastoral Leader field") assumes exactly one. Setting a Pastoral Leader therefore has to be an atomic replace (retire any existing active leader assignment(s), then insert the new one) in one `SECURITY DEFINER` function — not two sequential client calls, per the atomicity rule.
I also found a real defect in the existing `updateMember`/`softDeleteMember` functions: neither distinguishes "no such row" from success — a PATCH/DELETE against a nonexistent or foreign-tenant id currently either 500s or silently no-ops. Since Member Edit is the first UI surface to call these by id directly, this DIP fixes both to return canonical `NOT_FOUND_IN_TENANT`.
One open question I'm flagging rather than deciding silently: nothing in the PDD/spec restricts who can be set as a Pastoral Leader — `createLeaderAssignment` today accepts any active member id. I've defaulted to "any active member in the tenant," matching current behavior, but you may want this restricted to Leader/Admin-role members only. Say the word and I'll adjust before handing to CC.
Story Summary
Admin-facing member management: a list screen (FP-69) that's the entry point into an edit screen (FP-72). The list shows name, email, role, and active/deactivated status; "Add Member" routes to the existing invite flow rather than a new creation form (`POST /api/members` requires a real `userId`, which only exists post-registration). Clicking a member opens Edit, where an Admin can update name/email/role via the existing `PATCH /api/members`, and set or change the member's Pastoral Leader — a direct member-to-member link stored in `assignments` (`assignment_type = 'LEADER'`), explicitly not routed through Groups (that idea was considered and walked back per FP-72's Jira description). Deactivate is available now but ships without FP-74's "block if members still assigned" guard — Group C hasn't landed yet, so this is a known, temporary gap, not an oversight.
These two stories are combined because FP-69's own AC says clicking a member opens FP-72 directly — there's no independent scope for the list without the edit screen it links to.
Repo Target
Web (Next.js, `owgc-tech/flockpulse-web`). No mobile surface for either story.
Grounding Check

* Both stories fetched live via Jira (`FP-69`, `FP-72`), status To Do, parent `FP-8` — matches the manifest exactly, nothing stale.
* Schema verified against actual code, not the spec: `members` table has `first_name`/`last_name`/`email`/`role`/`deleted_at` (spec's naming happens to match here); `assignments` has typed `group_id`/`leader_member_id` columns with a `assignment_type` CHECK and per-type partial unique indexes — not the spec's `members.pastoral_leader_id` column, which does not exist. `src/features/members/service.ts` (`listMembers`/`createMember`/`updateMember`/`softDeleteMember`) and `src/features/assignments/service.ts` (`createLeaderAssignment`, `softDeleteAssignment`) both confirmed current.
* Cross-tenant safety: no existing trigger on `assignments` validates `group_id`/`leader_member_id` against the row's own `tenant_id` — bare FKs only guarantee existence. This DIP adds `validate_assignment_tenant()`, mirroring the existing `validate_event_talk_id()` pattern, firing on `BEFORE INSERT OR UPDATE`.
* Atomicity: "set Pastoral Leader" is a retire-old/insert-new pair against the same table in one logical action. Per the standing atomicity rule this is one `SECURITY DEFINER` function (`set_member_pastoral_leader`), not two `.from('assignments')` calls from the client — a partial failure between them would otherwise leave a member with zero or two active leaders, and the unique index doesn't prevent the latter.
* Canonical error codes: uses `NOT_FOUND_IN_TENANT` (member id doesn't resolve in tenant — new, this DIP fixes the gap), `CROSS_TENANT_ACCESS` (trigger violation — already canonical, reused, not reinvented), `INVALID_TARGET` (leader id doesn't resolve to an active member — canonical, reused), `VALIDATION_ERROR` (missing/invalid fields), `DUPLICATE_ACTIVE_RECORD` is not introduced here — the existing `DUPLICATE_EMAIL` on `createMember` is left as-is since this DIP doesn't touch member creation.
* Migration head: manifest states `20260711000034` as of last session — do not trust this blindly; confirm the actual current head live (`ls supabase/migrations/ | tail -5` or equivalent) before naming this migration, and use the next sequential timestamp.
* Frontend convention: Atlas has no visibility into the actual frontend page files (not present in project knowledge — only backend/migrations/docs were indexed). Before creating any `.tsx` files, check the existing Events List/Create/Edit screens (built in FP-60/61/64/65/67) live in the repo and mirror their directory structure, layout wrapper, and table/form component conventions exactly. Do not invent a new convention.
* FP-54 invite route: FP-69's "Add Member" button must link to the existing invite screen. Atlas doesn't have this route path in indexed knowledge — grep the repo for the actual invite/registration-initiation route (likely under `app/` near `register`/`invite`) and confirm before wiring the link. Do not guess a path.
* Deliberate scope boundary carried forward: Deactivate has no guard against "still someone's assigned leader" until FP-74 (Group C). Ship it now per FP-72's own AC; add a one-line code comment (`// TODO(FP-74): block deactivation while LEADER assignments still point here`) at the call site so this isn't silently forgotten.
* Group membership: explicitly out of scope per FP-72's own description (that's FP-71). Nothing in this DIP touches group assignment.
Implementation Plan
Phase 0 — Branch & live verification

1. Create branch `feature/FP-69-FP-72-member-list-edit` off `dev`.
2. Confirm current migration head live; do not reuse the manifest's stated number without checking.
3. Grep the repo for the existing invite/registration route (FP-69's "Add Member" target) and the existing Events List/Create/Edit screen directory structure (frontend convention to mirror). Note both in the PR description.
4. Persist this DIP verbatim to `documentation/dips/DIP-FP-69-FP-72.md` before any other change.
Phase 1 — Schema (single new migration file) 5. Add `validate_assignment_tenant()` — `SECURITY DEFINER`, `BEFORE INSERT OR UPDATE` on `assignments`: if `NEW.group_id IS NOT NULL`, confirm a row in `groups` with that id and matching `tenant_id`; if `NEW.leader_member_id IS NOT NULL`, confirm a row in `members` with that id, matching `tenant_id`, and `deleted_at IS NULL`. Raise on failure using the `CROSS_TENANT_ACCESS` code in the exception message so the app layer can map it cleanly. Guard the `CREATE TRIGGER` with `DROP TRIGGER IF EXISTS` first (idempotency convention). 6. Add `set_member_pastoral_leader(p_member_id UUID, p_leader_member_id UUID, p_tenant_id UUID, p_actor_user_id UUID) RETURNS TABLE (id UUID, member_id UUID, leader_member_id UUID, created_at TIMESTAMPTZ)` — `SECURITY DEFINER`, `SET search_path = public, pg_catalog`:

* Soft-delete (`deleted_at = now()`) any existing active `LEADER` assignment(s) for `p_member_id` within `p_tenant_id` (defensive: more than one may exist today since the index doesn't prevent it).
* If `p_leader_member_id IS NULL`, stop there (this is "clear the Pastoral Leader") and return an empty set.
* Otherwise insert the new `LEADER` assignment row (the `validate_assignment_tenant()` trigger fires automatically and enforces same-tenant/active-leader — nothing to duplicate here).
* Write an audit_logs row: `entity_type = 'assignment'`, `action = 'SET_PASTORAL_LEADER'`, `before_value = jsonb_build_object('leader_member_id', <old, if any, else null>)`, `after_value = jsonb_build_object('leader_member_id', p_leader_member_id)`, `actor_id = p_actor_user_id`. Verify live how `audit_logs.actor_id` is populated by existing audit-writing functions (e.g. `cancel_event_with_audit()`) before deciding whether this should be `auth.uid()` or the resolved `member_id` — match the established convention, don't invent a new one.
* Return the new row (or nothing, if cleared).

7. `supabase db reset` locally to validate the full migration chain before touching application code.
Phase 2 — Application layer 8. `src/features/members/service.ts`:

* Add `getMemberById(id, tenantId)` for Edit-screen prefill — same tenant-scoping pattern as `listMembers`.
* Fix `updateMember`: if the underlying `.single()` call errors with no matching row (Supabase `PGRST116`), throw with `code: 'NOT_FOUND_IN_TENANT'` instead of letting the raw Postgrest error propagate as a 500.
* Fix `softDeleteMember`: check rows-affected (switch to `.select('id').single()` on the update, or equivalent) and throw the same `NOT_FOUND_IN_TENANT` if nothing matched, rather than silently returning success.

9. `app/api/members/route.ts`:
   * Extend `GET` to accept an optional `?id=` query param and call `getMemberById` when present (keeps the existing query-param convention already used by this file's `PATCH`/`DELETE`, rather than introducing a `[id]` dynamic segment inconsistent with this specific route file).
   * Update `PATCH`/`DELETE` error handling to map `NOT_FOUND_IN_TENANT` to a 404 response with that code.
10. `src/features/assignments/service.ts`: add `getActiveLeaderAssignment(memberId, tenantId)` (read, for Edit-screen prefill of the current Pastoral Leader) and `setPastoralLeader(memberId, leaderMemberId, tenantId, actorUserId)` — thin wrapper calling the `set_member_pastoral_leader` RPC via `supabase.rpc()`. Map the trigger's `CROSS_TENANT_ACCESS` exception and an "leader not found/inactive" case (`INVALID_TARGET`) to typed errors the route can translate to HTTP codes.
11. New file `app/api/members/[id]/pastoral-leader/route.ts`:
    * `PUT` — body `{ leaderMemberId: string | null }`. Admin-only. Calls `setPastoralLeader`. `null` clears the assignment (no replacement inserted). Maps `CROSS_TENANT_ACCESS` → 403, `INVALID_TARGET` → 422, else 200 with the resulting row (or `{ cleared: true }` if nulled).
Phase 3 — Frontend (mirror existing Events List/Create/Edit conventions exactly — confirm live in Phase 0 before writing) 12. Member List screen: table of name/email/role/status; "Add Member" button linking to the existing invite route found in Phase 0 (not a new form); each row links to that member's Edit screen. 13. Member Edit screen: form for first/last name, email, role (via `PATCH /api/members?id=`); a Pastoral Leader selector (dropdown of active tenant members, prefilled via `getActiveLeaderAssignment`, saved via the new `PUT .../pastoral-leader` endpoint); a Deactivate action calling the existing `DELETE /api/members?id=` — no FP-74 guard yet, include the `TODO(FP-74)` comment at the call site. 14. Cancel/Back navigation on both screens, following the nav-link pattern already established in the FP-60/61/64/65/67 adj-1 fix (Edit's Cancel returns to the member's own detail context or the list — there's no separate Member Detail screen per these ACs, so Cancel from Edit returns to the List).
Files to Create/Modify

* `supabase/migrations/[NEXT_SEQUENTIAL_TIMESTAMP]_assignments_tenant_trigger_and_pastoral_leader_rpc.sql` (new)
* `src/features/members/service.ts` (modify)
* `app/api/members/route.ts` (modify)
* `src/features/assignments/service.ts` (modify)
* `app/api/members/[id]/pastoral-leader/route.ts` (new)
* Frontend member list + edit screens and any shared components — exact paths to be confirmed live against the existing Events screens' convention in Phase 0; do not invent a path ahead of that check.
Migration Files

```sql
-- supabase/migrations/[NEXT_SEQUENTIAL_TIMESTAMP]_assignments_tenant_trigger_and_pastoral_leader_rpc.sql
-- FP-69/FP-72: cross-tenant safety trigger for assignments FKs (gap left open since
-- 20260629000003) + atomic Pastoral Leader replace RPC.

-- ==============================================================
-- SECTION 1: cross-tenant validation trigger for assignments.
-- Bare FKs on group_id/leader_member_id only confirm the referenced row
-- exists, not that it belongs to the same tenant as the assignment row.
-- ==============================================================

CREATE OR REPLACE FUNCTION validate_assignment_tenant()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.group_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM groups g
      WHERE g.id = NEW.group_id AND g.tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'CROSS_TENANT_ACCESS: group_id % does not belong to tenant %', NEW.group_id, NEW.tenant_id;
    END IF;
  END IF;

  IF NEW.leader_member_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM members m
      WHERE m.id = NEW.leader_member_id
        AND m.tenant_id = NEW.tenant_id
        AND m.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'CROSS_TENANT_ACCESS: leader_member_id % does not belong to tenant % or is inactive', NEW.leader_member_id, NEW.tenant_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog;

DROP TRIGGER IF EXISTS trigger_validate_assignment_tenant ON assignments;
CREATE TRIGGER trigger_validate_assignment_tenant
BEFORE INSERT OR UPDATE ON assignments
FOR EACH ROW EXECUTE FUNCTION validate_assignment_tenant();

-- ==============================================================
-- SECTION 2: atomic Pastoral Leader replace.
-- The partial unique index idx_assignments_unique_active_leader only
-- blocks duplicating the SAME (member, leader) pair — it does not stop
-- a member from having two different active LEADER assignments at once.
-- This function makes "set the Pastoral Leader" a single atomic action:
-- retire any existing active LEADER assignment(s), then insert the new
-- one (or stop after retiring, if clearing).
--
-- VERIFY LIVE before finalizing: how audit_logs.actor_id is populated by
-- other existing audit-writing functions (e.g. cancel_event_with_audit()).
-- Match that convention — do not invent a new one here.
-- ==============================================================

CREATE OR REPLACE FUNCTION set_member_pastoral_leader(
  p_member_id UUID,
  p_leader_member_id UUID,   -- NULL clears the Pastoral Leader
  p_tenant_id UUID,
  p_actor_user_id UUID
)
RETURNS TABLE (id UUID, member_id UUID, leader_member_id UUID, created_at TIMESTAMPTZ) AS $$
DECLARE
  v_old_leader_id UUID;
  v_new_row assignments%ROWTYPE;
BEGIN
  SELECT leader_member_id INTO v_old_leader_id
  FROM assignments
  WHERE assignments.member_id = p_member_id
    AND assignments.tenant_id = p_tenant_id
    AND assignment_type = 'LEADER'
    AND deleted_at IS NULL
  LIMIT 1;

  UPDATE assignments
  SET deleted_at = now()
  WHERE assignments.member_id = p_member_id
    AND assignments.tenant_id = p_tenant_id
    AND assignment_type = 'LEADER'
    AND deleted_at IS NULL;

  IF p_leader_member_id IS NULL THEN
    IF v_old_leader_id IS NOT NULL THEN
      INSERT INTO audit_logs (tenant_id, entity_type, entity_id, action, actor_id, before_value, after_value, "timestamp")
      VALUES (
        p_tenant_id, 'assignment', p_member_id, 'CLEAR_PASTORAL_LEADER', p_actor_user_id,
        jsonb_build_object('leader_member_id', v_old_leader_id),
        jsonb_build_object('leader_member_id', NULL),
        now()
      );
    END IF;
    RETURN;
  END IF;

  INSERT INTO assignments (tenant_id, member_id, assignment_type, leader_member_id)
  VALUES (p_tenant_id, p_member_id, 'LEADER', p_leader_member_id)
  RETURNING * INTO v_new_row;

  INSERT INTO audit_logs (tenant_id, entity_type, entity_id, action, actor_id, before_value, after_value, "timestamp")
  VALUES (
    p_tenant_id, 'assignment', v_new_row.id, 'SET_PASTORAL_LEADER', p_actor_user_id,
    jsonb_build_object('leader_member_id', v_old_leader_id),
    jsonb_build_object('leader_member_id', p_leader_member_id),
    now()
  );

  RETURN QUERY SELECT v_new_row.id, v_new_row.member_id, v_new_row.leader_member_id, v_new_row.created_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog;

```

Branch Name
`feature/FP-69-FP-72-member-list-edit`
Commit Message
`FP-69-FP-72: implement admin member list and member edit screen with atomic pastoral leader reassignment`
Pull Request Description

* FP-69: Member List screen — name/email/role/status columns; "Add Member" links to the existing invite flow (route confirmed live, not assumed); clicking a row opens Member Edit.
* FP-72: Member Edit screen — first/last name, email, role via existing `PATCH /api/members`; Pastoral Leader field backed by a new atomic `set_member_pastoral_leader()` RPC (replaces the prior two-call risk); Deactivate wired to existing `DELETE /api/members`, explicitly without FP-74's guard (`TODO(FP-74)` left in place, Group C not yet landed).
* Also fixes two pre-existing gaps surfaced during grounding: `updateMember`/`softDeleteMember` now return `NOT_FOUND_IN_TENANT` instead of a raw 500 or silent no-op on a nonexistent/foreign-tenant id; `assignments.group_id`/`leader_member_id` now have a `BEFORE INSERT/UPDATE` cross-tenant trigger, closing a gap left open since the 000003 remediation migration.
* Note to reviewer: confirm whether Pastoral Leader assignment should be restricted to members with role `LEADER`/`ADMIN` — current implementation (matching existing `createLeaderAssignment` behavior) allows any active member.
Jira Linkage

* PDEEpicID: FP-8 (EPIC-2 — Member & Group Management)
* PDEStoryID: FP-69, FP-72
Stop Point
Save this DIP verbatim to `documentation/dips/DIP-FP-69-FP-72.md` and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against `dev` and stop. Do not merge — the user will check out the branch locally, test it, and merge manually against the deployed `dev` environment after review.
Include full diffs for every file in the completion report — full `git diff` output or complete new-file contents, no elisions, plus `git diff dev [branch] -- [path]` showing zero output for any file this DIP required to stay untouched.
