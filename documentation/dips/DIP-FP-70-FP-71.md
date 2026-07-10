Good — recording that. Before drafting Group B, a few things surfaced worth flagging up front rather than deciding silently:

1. A genuine design gap FP-70's AC doesn't address: what happens to a group's active membership (`assignments` rows) when the group itself is soft-deleted? Nothing in the spec or story says, but leaving members silently "in" a group that no longer exists is a real data-integrity concern — similar in shape to FP-74's leader-deactivation problem, just for groups. I'm defaulting to "soft-deleting a group also retires its active `GROUP` assignments, atomically" rather than leaving them dangling. Flagging this as a decision, not burying it.
2. `app/admin/community` already exists in the nav (visible in `AdminSidebar.tsx` from Group A's grounding) and I don't have visibility into what it currently renders — it's plausible it's already a partial Groups-ish screen. CC needs to check this live before building a new Groups List page from scratch, to avoid creating a redundant/conflicting screen.
3. Per FP-71's own AC ("reuses existing assignment mechanism, no new write path"), Group Edit's add/remove-member actions should call the existing `/api/assignments` POST/DELETE directly — not a new wrapper endpoint. Only a new read endpoint is needed (nothing today lists a group's current members).

Story Summary
Full CRUD for Groups (FP-70) plus the screen for managing a group's membership (FP-71). Today `groups` only supports `GET`/`POST` — no edit, no soft-delete, no audit trail, and no `updated_at`/`created_by`/`updated_by`/`deleted_at` columns. This DIP brings Groups up to the same CRUD pattern already established for Courses/Modules/Talks/Event Types, and adds the Group Edit screen where an Admin renames or deactivates a group and adds/removes members — the latter via the existing `assignments` write path (`assignment_type = 'GROUP'`), unchanged. These two stories are combined because FP-71 explicitly depends on FP-70 and lives as a section within the same Group Edit screen FP-70 creates — there's no independent scope for one without the other.
Repo Target
Web (Next.js, `owgc-tech/flockpulse-web`). No mobile surface.
Grounding Check

* Both stories fetched live via Jira (`FP-70`, `FP-71`), status To Do, parent `FP-8` — FP-69/FP-72 confirmed Done. Nothing stale.
* Schema verified against actual code: `groups` table currently has only `id, tenant_id, name, created_at` — no `updated_at`/`created_by`/`updated_by`/`deleted_at`. RLS has SELECT (tenant-scoped) and INSERT (admin-only) policies only — no UPDATE or DELETE policy exists yet, confirmed via the same live trigger/policy check done for Group A. `src/features/groups/service.ts` confirmed still `listGroups`/`createGroup` only.
* No existing "list this group's members" read — `listAssignments` returns every tenant assignment unfiltered; a new `getGroupMembers(groupId, tenantId)` is needed. Writes reuse `createGroupAssignment`/`softDeleteAssignment` and the existing `/api/assignments` POST/DELETE routes exactly as FP-71's AC requires — no new write path.
* Audit convention, now confirmed live (from Group A's grounding): every audited mutation in this codebase goes through a `SECURITY DEFINER` function calling the shared `write_audit_log(p_tenant_id, p_entity_type, p_entity_id, p_action, p_actor_id, p_before, p_after)` helper — never a raw `INSERT INTO audit_logs`. FP-70's own title says "audit trail," so Groups create/update/soft-delete follow this exact pattern.
* Atomicity applies here too, for a subtler reason than usual: writing a `groups` row and an `audit_logs` row in the same action is itself a two-table write, so per the standing atomicity rule, `create`/`update`/`soft-delete` on groups each need their own `SECURITY DEFINER` function — not a client `.insert()` plus a separate audit call. Soft-delete is a third table wider still (see next point).
* Flagged decision (not in either story's AC): soft-deleting a group should also retire its active `GROUP` assignments in the same transaction, rather than leaving members pointed at a deactivated group indefinitely. This is a genuine judgment call, not dictated by the spec — flagging it here rather than deciding silently. If you'd rather groups be deletable only when empty (blocking, like FP-74's pattern), say so and I'll redraft this section; the atomic-cascade approach is my default absent other direction.
* Frontend gap to verify live before building anything: `app/admin/community` already exists in the nav (confirmed live during Group A's grounding) and Atlas has no visibility into what it currently renders. CC must check this first — if it's already a partial Groups screen, extend it; if it's unrelated (e.g., a placeholder or something else entirely), build a new `app/admin/(shell)/groups` screen mirroring the Events convention. Do not assume either way.
* No uniqueness constraint on group name exists today, and neither FP-70's nor FP-71's AC asks for one (unlike members' unique-active-email rule). Not adding one — flagging that this diverges from the Developer Execution Packet's WP-3 language ("enforce unique active name per tenant"), which is spec-level aspiration, not this story's actual AC. Say the word if you want it added.
* Migration head: last confirmed live at `20260712000035` (Group A's migration). Re-confirm live, don't trust that number blindly — this session's work may not be the only thing that's landed.
* Cross-tenant safety for `GROUP` assignments is already covered by Group A's `validate_assignment_tenant()` trigger — nothing new needed there.
Implementation Plan
Phase 0 — Branch & live verification

1. Branch `feature/FP-70-FP-71-groups-crud-membership` off `dev`.
2. Confirm current migration head live.
3. Check what `app/admin/community` currently renders — determines whether this DIP extends it or builds a new `app/admin/(shell)/groups` directory. Note the finding in the PR description.
4. Confirm current RLS policies on `groups` live (`pg_policies` or equivalent) to verify no UPDATE/DELETE policy exists, matching this Grounding Check.
5. Persist this DIP verbatim to `documentation/dips/DIP-FP-70-FP-71.md` before any other change.
Phase 1 — Schema (single new migration file) 6. `ALTER TABLE groups ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES members(id), ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES members(id), ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`. 7. Add `groups_update_admin` RLS policy — admin-only, reachable regardless of `deleted_at` (same reasoning as `members_update_admin`: the admin performing the soft-delete needs to reach the row). Update the existing SELECT policy to exclude `deleted_at IS NOT NULL` for non-admins (mirror the members pattern: a separate `groups_select_admin_all` policy so Admin can still see deactivated groups for audit/restore, same as members). 8. `create_group_with_audit(p_tenant_id, p_name, p_actor_member_id) RETURNS TABLE (...)` — `SECURITY DEFINER`: insert the group row (`created_by = p_actor_member_id`), call `write_audit_log(..., 'group', <new id>, 'CREATE_GROUP', p_actor_member_id, NULL, jsonb_build_object('name', p_name))`, return the row. 9. `update_group_with_audit(p_group_id, p_tenant_id, p_name, p_actor_member_id) RETURNS TABLE (...)` — `SECURITY DEFINER`: fetch current name for `before_value`, update (`updated_at = now()`, `updated_by = p_actor_member_id`), call `write_audit_log(..., 'group', p_group_id, 'UPDATE_GROUP', p_actor_member_id, jsonb_build_object('name', <old>), jsonb_build_object('name', p_name))`, return the updated row. Raise `NOT_FOUND_IN_TENANT`-style (or return no rows, mapped by the app layer) if the id doesn't resolve in-tenant — get this right from the start this time, no adj-fix needed later. 10. `soft_delete_group_with_audit(p_group_id, p_tenant_id, p_actor_member_id) RETURNS VOID` — `SECURITY DEFINER`: soft-delete the group row (`updated_by = p_actor_member_id`), soft-delete every active `assignments` row where `group_id = p_group_id AND assignment_type = 'GROUP' AND deleted_at IS NULL` (the flagged cascade decision above), write one audit_logs entry (`action = 'DEACTIVATE_GROUP'`) capturing how many memberships were retired in `before_value`/`after_value` for traceability. All in one transaction. 11. `supabase db reset` locally to validate before touching application code.
Phase 2 — Application layer 12. `src/features/groups/service.ts`: - Extend `listGroups`/add `getGroupById` to select the new columns; `listGroups` gains an `includeDeleted` param mirroring `listMembers`'s convention from Group A (needed so a Groups List screen can show status). - Replace direct `.insert()` in `createGroup` with a call to `create_group_with_audit` RPC; add `updateGroup`/`softDeleteGroup` wrapping the other two RPCs. 13. `src/features/assignments/service.ts`: add `getGroupMembers(groupId, tenantId)` — join to `members`, same shape as `getMyAssignedMembers`, filtered on `assignment_type = 'GROUP'`. 14. `app/api/groups/route.ts`: extend `GET` for optional `?id=` (single-group fetch) and `?includeDeleted=true`; `POST` now passes `ctx.memberId` as actor; add `PATCH`/`DELETE` handlers (mirroring `app/api/members/route.ts`'s query-param convention) mapping `NOT_FOUND_IN_TENANT` to 404. 15. New file `app/api/groups/[id]/members/route.ts` — `GET` only, tenant-scoped, open to all authenticated roles (matching the existing read-openness convention for `/api/groups`), returns the group's current active membership via `getGroupMembers`.
Phase 3 — Frontend (contingent on Phase 0.3's finding) 16. If `app/admin/community` is unrelated: build `app/admin/(shell)/groups/{page.tsx, new/page.tsx, [id]/edit/page.tsx}` mirroring the Events directory convention exactly (established in FP-60/61/64/65/67, reused in FP-69/72). If it's already a partial Groups surface: extend it in place instead — do not create a parallel, conflicting screen. 17. Groups List: name, status (active/deactivated); "Create Group" action; row click → Group Edit. 18. Group Edit: rename field (`PATCH /api/groups?id=`), Deactivate action (`DELETE /api/groups?id=`), and a Membership section listing current members (via the new `GET /api/groups/[id]/members`) with Add (existing `POST /api/assignments`, `assignmentType: 'GROUP'`) and Remove (existing `DELETE /api/assignments?id=<assignmentId>`) actions — no new write endpoint, per FP-71's AC. 19. Cancel/Back navigation on both screens, following the established nav-link convention.
Files to Create/Modify

* `supabase/migrations/[NEXT_SEQUENTIAL_TIMESTAMP]_groups_full_crud_audit.sql` (new)
* `src/features/groups/service.ts` (modify)
* `src/features/assignments/service.ts` (modify — add `getGroupMembers`)
* `app/api/groups/route.ts` (modify)
* `app/api/groups/[id]/members/route.ts` (new)
* Frontend Groups List/Edit screens — path contingent on Phase 0.3's live check of `app/admin/community`; do not assume before checking.
Migration Files

```sql
-- supabase/migrations/[NEXT_SEQUENTIAL_TIMESTAMP]_groups_full_crud_audit.sql
-- FP-70/FP-71: Groups full CRUD + audit trail; cascades soft-delete to active GROUP
-- assignments (flagged design decision, see DIP-FP-70-FP-71 Grounding Check).

ALTER TABLE groups
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES members(id),
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES members(id),
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Non-admin SELECT excludes deactivated groups; admin can see all (audit/restore).
DROP POLICY IF EXISTS "Groups are visible to members of the same tenant" ON groups;
CREATE POLICY "groups_select" ON groups
  FOR SELECT USING (tenant_id = get_tenant_id() AND deleted_at IS NULL);
CREATE POLICY "groups_select_admin_all" ON groups
  FOR SELECT USING (
    tenant_id = get_tenant_id()
    AND EXISTS (SELECT 1 FROM members m WHERE m.user_id = auth.uid() AND m.tenant_id = get_tenant_id() AND m.role = 'ADMIN' AND m.deleted_at IS NULL)
  );

CREATE POLICY "groups_update_admin" ON groups
  FOR UPDATE
  USING (
    tenant_id = get_tenant_id()
    AND EXISTS (SELECT 1 FROM members m WHERE m.user_id = auth.uid() AND m.tenant_id = get_tenant_id() AND m.role = 'ADMIN' AND m.deleted_at IS NULL)
  )
  WITH CHECK (tenant_id = get_tenant_id());

CREATE OR REPLACE FUNCTION public.create_group_with_audit(
  p_tenant_id UUID, p_name TEXT, p_actor_member_id UUID
)
RETURNS TABLE (id UUID, name TEXT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE v_row groups%ROWTYPE;
BEGIN
  INSERT INTO groups (tenant_id, name, created_by)
  VALUES (p_tenant_id, p_name, p_actor_member_id)
  RETURNING * INTO v_row;

  PERFORM write_audit_log(p_tenant_id, 'group', v_row.id, 'CREATE_GROUP', p_actor_member_id, NULL, jsonb_build_object('name', p_name));

  RETURN QUERY SELECT v_row.id, v_row.name, v_row.created_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_group_with_audit(
  p_group_id UUID, p_tenant_id UUID, p_name TEXT, p_actor_member_id UUID
)
RETURNS TABLE (id UUID, name TEXT, updated_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE v_old_name TEXT; v_row groups%ROWTYPE;
BEGIN
  SELECT g.name INTO v_old_name FROM groups g WHERE g.id = p_group_id AND g.tenant_id = p_tenant_id AND g.deleted_at IS NULL;
  IF v_old_name IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND_IN_TENANT: group % not found in tenant %', p_group_id, p_tenant_id;
  END IF;

  UPDATE groups SET name = p_name, updated_at = now(), updated_by = p_actor_member_id
  WHERE groups.id = p_group_id AND groups.tenant_id = p_tenant_id
  RETURNING * INTO v_row;

  PERFORM write_audit_log(p_tenant_id, 'group', p_group_id, 'UPDATE_GROUP', p_actor_member_id,
    jsonb_build_object('name', v_old_name), jsonb_build_object('name', p_name));

  RETURN QUERY SELECT v_row.id, v_row.name, v_row.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.soft_delete_group_with_audit(
  p_group_id UUID, p_tenant_id UUID, p_actor_member_id UUID
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE v_exists BOOLEAN; v_retired_count INT;
BEGIN
  SELECT EXISTS (SELECT 1 FROM groups WHERE id = p_group_id AND tenant_id = p_tenant_id AND deleted_at IS NULL) INTO v_exists;
  IF NOT v_exists THEN
    RAISE EXCEPTION 'NOT_FOUND_IN_TENANT: group % not found in tenant %', p_group_id, p_tenant_id;
  END IF;

  UPDATE groups SET deleted_at = now(), updated_by = p_actor_member_id
  WHERE groups.id = p_group_id AND groups.tenant_id = p_tenant_id;

  -- Flagged cascade decision: retire active GROUP assignments rather than leave them
  -- pointed at a deactivated group.
  WITH retired AS (
    UPDATE assignments SET deleted_at = now()
    WHERE assignments.group_id = p_group_id
      AND assignments.tenant_id = p_tenant_id
      AND assignments.assignment_type = 'GROUP'
      AND assignments.deleted_at IS NULL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_retired_count FROM retired;

  PERFORM write_audit_log(p_tenant_id, 'group', p_group_id, 'DEACTIVATE_GROUP', p_actor_member_id,
    jsonb_build_object('deleted_at', NULL),
    jsonb_build_object('deleted_at', now(), 'memberships_retired', v_retired_count));
END;
$$;

```

Branch Name
`feature/FP-70-FP-71-groups-crud-membership`
Commit Message
`FP-70-FP-71: implement full groups CRUD with audit trail and group membership management`
Pull Request Description

* FP-70: Groups gain full CRUD — `PATCH`/`DELETE` alongside existing `GET`/`POST`, new `updated_at`/`created_by`/`updated_by`/`deleted_at` columns, admin-only writes via new `SECURITY DEFINER` audit-writing functions matching the codebase's established `write_audit_log()` convention (not a raw INSERT).
* FP-71: Group Edit screen adds a membership section — lists current members via a new read-only endpoint, adds/removes via the existing `/api/assignments` POST/DELETE, no new write path.
* Flagged design decision requiring reviewer sign-off: soft-deleting a group now cascades to retire its active `GROUP` assignments in the same transaction (not specified by either story's AC — Atlas's default absent other direction; see DIP Grounding Check).
* Note whether `app/admin/community` was extended or a new `app/admin/(shell)/groups` directory was created, and why.
Jira Linkage

* PDEEpicID: FP-8 (EPIC-2 — Member & Group Management)
* PDEStoryID: FP-70, FP-71
Stop Point
Save this DIP verbatim to `documentation/dips/DIP-FP-70-FP-71.md` and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against `dev` and stop. Do not merge — the user will review, merge, and test against deployed `dev` afterward.
Include full diffs for every file in the completion report — no elisions — plus `git diff dev [branch] -- [path]` showing zero output for any file this DIP required to stay untouched.
