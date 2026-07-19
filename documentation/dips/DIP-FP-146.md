DIP-FP-146.md
Story Summary
Adds a transferable Owner concept to Groups, distinct from the existing immutable created_by audit field — owner_member_id starts equal to the creator but can be reassigned by an Admin afterward, following the exact precedent already established for Pastoral Leader reassignment (FP-73/74). Adds the "My Groups" / "All Groups" split to the Groups admin page, a deactivation guard blocking a member from being deactivated while they still own groups, and both single and bulk owner-reassignment. Per the story's own explicit scope: this builds the mechanism at the API/data layer but does not flip the Groups page's existing Admin-tier-only gate — that broader "should Leaders access this page at all" decision stays deliberately separate.
Repo Target
Web (Next.js) — owgc-tech/flockpulse-web.
Grounding Check
Confirmed live against dev:

groups.created_by already exists (FP-36/70-71's CRUD-audit migration) and is genuinely immutable — never touched by this DIP.
groups/page.tsx already hard-gates the whole page to Admin-tier, with an explicit comment: "DIP-FP-114-web: Groups stays fully Admin-tier-only, excluded for Leader-tier." This DIP does not touch that gate — confirmed as the right scope boundary, matching the story's own "explicitly out of scope" note.
Exact precedent to mirror (FP-73/74, migration 20260714000037): block_member_deactivation_if_assigned_leader() — a BEFORE UPDATE trigger on members, firing only on the soft-delete transition (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL), raising a plain descriptive exception with the affected count embedded in the message. App-layer catch (member.service.ts's softDeleteMember) matches on error.code === 'P0001' + a message substring, mapping to INVALID_STATE_TRANSITION with a parsed count field. bulk_reassign_leader_members_with_audit() is the exact shape to mirror for bulk owner reassignment, including its outgoing≠incoming validation.
members already has one BEFORE UPDATE trigger for the Pastoral Leader guard. This DIP adds a second, independent trigger for the group-ownership guard (not merged into the existing one) — matching this codebase's established one-trigger-per-guard-reason convention (see FP-29's original single-purpose trigger). Postgres supports multiple BEFORE UPDATE triggers on the same table/event without conflict.
Groups API RBAC, confirmed live (app/api/groups/route.ts): GET is open to any authenticated tenant member; POST and PATCH are both requireRole('ADMIN'); there is no [id]/route.ts — everything routes through query-param id on the single route.ts file. Per the story's AC ("Leader-tier: sees every group... can edit only groups where owner_member_id = themselves"), POST and PATCH both widen to requireRole('LEADER'), with an explicit ownership check added inside the PATCH handler for non-Admin callers. DELETE (deactivating a group) stays Admin-only, unchanged — the story's AC only mentions edit permission, not deactivation; deactivating a group is more consequential and this DIP makes the conservative choice not to extend that without being asked. Flagging explicitly as a scope decision, not an oversight.
Existing bulk-reassign-leader endpoint (app/api/assignments/bulk-reassign-leader/route.ts) is the exact shape to mirror for the new bulk-reassign-group-owner endpoint: requireRole('ADMIN'), body { outgoingXMemberId, incomingXMemberId }, VALIDATION_ERROR/CROSS_TENANT_ACCESS error mapping. No dedicated UI page exists for the Leader bulk-reassign flow either (API-only) — this DIP follows that same precedent for group-owner bulk reassignment: API-only, no new UI page, consistent with existing practice rather than a gap.
GroupEditForm.tsx already receives an allMembers: MemberOption[] prop (used today for the "add member to group" picker) — reused directly for the new single-owner-reassign dropdown, no new data-fetching needed at that screen.
Owner display names: listGroups() only returns raw owner_member_id (a UUID) — resolving it to a display name requires a members lookup. Rather than adding a SQL join inside the repository, groups/page.tsx fetches listMembers(tenantId) (not currently called there) and builds a simple Map<id, name> client-side, matching this codebase's established "fetch separately, merge in JS" convention (e.g. getRsvpReportSummary) rather than a raw join.
My Groups / All Groups split is genuinely interim-state given the page stays Admin-only: "My Groups" will only be non-empty when the Admin viewing the page happens to also own groups themselves — the split is built now specifically so it's ready the moment the page-level gate is loosened later, per the story's own stated intent, not a bug.
Domain rules: no conflict — new ownership concept and its guard/reassignment mechanism, no change to any RSVP/attendance/formation invariant.

Implementation Plan

Migration:

ALTER TABLE groups ADD COLUMN IF NOT EXISTS owner_member_id UUID REFERENCES members(id); then backfill UPDATE groups SET owner_member_id = created_by WHERE owner_member_id IS NULL;.
CREATE OR REPLACE FUNCTION create_group_with_audit(...): also set owner_member_id = p_actor_member_id on insert (DROP FUNCTION IF EXISTS first only if its RETURNS TABLE signature changes — it doesn't here, so a plain CREATE OR REPLACE suffices).
New reassign_group_owner_with_audit(p_group_id, p_tenant_id, p_new_owner_member_id, p_actor_member_id) RETURNS TABLE(id UUID, owner_member_id UUID): validates the group exists/active in tenant and the new owner is an active member of the same tenant (raising VALIDATION_ERROR/NOT_FOUND_IN_TENANT as appropriate, matching existing message-prefix conventions), updates owner_member_id, audit-logs via write_audit_log('group', ..., 'REASSIGN_GROUP_OWNER', ...).
New bulk_reassign_group_owner_with_audit(p_outgoing_owner_id, p_incoming_owner_id, p_tenant_id, p_actor_member_id) RETURNS TABLE(reassigned_count INT): mirrors bulk_reassign_leader_members_with_audit()'s exact structure — outgoing≠incoming validation, loops over every group where owner_member_id = p_outgoing_owner_id, reuses reassign_group_owner_with_audit() per group (not a duplicated inline update), returns count.
New block_member_deactivation_if_owns_groups() trigger function + trigger_block_member_deactivation_if_owns_groups (BEFORE UPDATE ON members), mirroring block_member_deactivation_if_assigned_leader()'s exact shape: fires only on the soft-delete transition, counts groups WHERE owner_member_id = NEW.id AND deleted_at IS NULL, raises 'Cannot deactivate member %: still owns % group(s) — reassign ownership first' if count > 0.


src/features/groups/service.ts: widen COLS to include owner_member_id. Add reassignGroupOwner(groupId, tenantId, newOwnerMemberId, actorMemberId) and bulkReassignGroupOwner(outgoingOwnerId, incomingOwnerId, tenantId, actorMemberId) wrapper functions calling the new RPCs, with the same NOT_FOUND_IN_TENANT/error-mapping conventions as updateGroup/softDeleteGroup.
src/features/members/service.ts: extend softDeleteMember's existing P0001 catch block with an additional check for 'still owns' in the message, mapping to the same INVALID_STATE_TRANSITION code with a new ownedGroupCount field (parsed the same way assignedMemberCount already is) — both guard reasons map to the same error code, distinguished by which count field is present.
app/api/groups/route.ts: POST and PATCH change from requireAdmin to requireRole('LEADER'). PATCH handler: after auth, if caller is not Admin-tier, fetch the group and verify owner_member_id === ctx.memberId before allowing the rename — return FORBIDDEN_ROLE (403) otherwise. DELETE stays requireAdmin, unchanged.
New app/api/groups/reassign-owner/route.ts: POST, requireRole('ADMIN'), body { groupId, newOwnerMemberId }, calls reassignGroupOwner.
New app/api/groups/bulk-reassign-owner/route.ts: POST, requireRole('ADMIN'), body { outgoingOwnerMemberId, incomingOwnerMemberId }, mirrors bulk-reassign-leader/route.ts exactly, calls bulkReassignGroupOwner.
app/admin/(shell)/groups/page.tsx: add listMembers(tenantId) fetch, build an id → name map. Split groups into myGroups (owner_member_id ===  the viewing Admin's own memberId, from user.app_metadata) and allGroups (everything). Pass both plus the name map to GroupsTable.
GroupsTable.tsx: render two sections divided by a horizontal rule — "My Groups" above, "All Groups" (the full list, unfiltered) below — each with a new "Owner" column showing the resolved name.
GroupEditForm.tsx: add an Admin-only "Owner" section — current owner's name, a dropdown (reusing the existing allMembers prop) to pick a new owner, and a "Reassign Owner" button calling the new single-reassign endpoint. Distinct from the existing Save/rename action, since RBAC differs (rename: owner-or-admin; reassign: admin-only).

Files to Create/Modify

supabase/migrations/20260719000049_group_owner_transfer_and_deactivation_guard.sql (new)
src/features/groups/service.ts
src/features/groups/group.types.ts (add owner_member_id: string | null to GroupRow)
src/features/members/service.ts
app/api/groups/route.ts
app/api/groups/reassign-owner/route.ts (new)
app/api/groups/bulk-reassign-owner/route.ts (new)
app/admin/(shell)/groups/page.tsx
app/admin/(shell)/groups/GroupsTable.tsx
app/admin/(shell)/groups/[id]/edit/GroupEditForm.tsx

Migration Files
```sql
-- DIP-FP-146: transferable group Owner (owner_member_id), distinct from the
-- existing immutable created_by. Deactivation guard + single/bulk
-- reassignment mirror the exact FP-73/74 Pastoral Leader precedent.

ALTER TABLE groups ADD COLUMN IF NOT EXISTS owner_member_id UUID REFERENCES members(id);
UPDATE groups SET owner_member_id = created_by WHERE owner_member_id IS NULL;

CREATE OR REPLACE FUNCTION public.create_group_with_audit(
  p_tenant_id UUID, p_name TEXT, p_actor_member_id UUID
)
RETURNS TABLE (id UUID, name TEXT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE v_row groups%ROWTYPE;
BEGIN
  INSERT INTO groups (tenant_id, name, created_by, owner_member_id)
  VALUES (p_tenant_id, p_name, p_actor_member_id, p_actor_member_id)
  RETURNING * INTO v_row;

  PERFORM write_audit_log(p_tenant_id, 'group', v_row.id, 'CREATE_GROUP', p_actor_member_id, NULL, jsonb_build_object('name', p_name));

  RETURN QUERY SELECT v_row.id, v_row.name, v_row.created_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.reassign_group_owner_with_audit(
  p_group_id UUID, p_tenant_id UUID, p_new_owner_member_id UUID, p_actor_member_id UUID
)
RETURNS TABLE (id UUID, owner_member_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE v_old_owner UUID; v_row groups%ROWTYPE; v_new_owner_valid BOOLEAN;
BEGIN
  SELECT g.owner_member_id INTO v_old_owner FROM groups g
    WHERE g.id = p_group_id AND g.tenant_id = p_tenant_id AND g.deleted_at IS NULL;
  IF v_old_owner IS NULL AND NOT EXISTS (SELECT 1 FROM groups WHERE id = p_group_id AND tenant_id = p_tenant_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'NOT_FOUND_IN_TENANT: group % not found in tenant %', p_group_id, p_tenant_id;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM members WHERE id = p_new_owner_member_id AND tenant_id = p_tenant_id AND deleted_at IS NULL
  ) INTO v_new_owner_valid;
  IF NOT v_new_owner_valid THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: new owner % is not an active member of this tenant', p_new_owner_member_id;
  END IF;

  UPDATE groups SET owner_member_id = p_new_owner_member_id, updated_at = now(), updated_by = p_actor_member_id
  WHERE groups.id = p_group_id AND groups.tenant_id = p_tenant_id
  RETURNING * INTO v_row;

  PERFORM write_audit_log(p_tenant_id, 'group', p_group_id, 'REASSIGN_GROUP_OWNER', p_actor_member_id,
    jsonb_build_object('owner_member_id', v_old_owner), jsonb_build_object('owner_member_id', p_new_owner_member_id));

  RETURN QUERY SELECT v_row.id, v_row.owner_member_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.bulk_reassign_group_owner_with_audit(
  p_outgoing_owner_id UUID, p_incoming_owner_id UUID, p_tenant_id UUID, p_actor_member_id UUID
)
RETURNS TABLE (reassigned_count INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE v_group_id UUID; v_count INT := 0;
BEGIN
  IF p_outgoing_owner_id = p_incoming_owner_id THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: outgoing and incoming owner must be different members';
  END IF;

  FOR v_group_id IN
    SELECT g.id FROM groups g
    WHERE g.owner_member_id = p_outgoing_owner_id AND g.tenant_id = p_tenant_id AND g.deleted_at IS NULL
  LOOP
    PERFORM reassign_group_owner_with_audit(v_group_id, p_tenant_id, p_incoming_owner_id, p_actor_member_id);
    v_count := v_count + 1;
  END LOOP;

  RETURN QUERY SELECT v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.block_member_deactivation_if_owns_groups()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE v_count INT;
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    SELECT COUNT(*) INTO v_count FROM groups WHERE owner_member_id = NEW.id AND deleted_at IS NULL;
    IF v_count > 0 THEN
      RAISE EXCEPTION 'Cannot deactivate member %: still owns % group(s) — reassign ownership first', NEW.id, v_count;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_block_member_deactivation_if_owns_groups ON members;
CREATE TRIGGER trigger_block_member_deactivation_if_owns_groups
BEFORE UPDATE ON members
FOR EACH ROW EXECUTE FUNCTION block_member_deactivation_if_owns_groups();
```
Branch Name
feature/FP-146-group-owner-transfer
Commit Message
FP-146: transferable group Owner, My/All Groups split, deactivation guard + single/bulk reassignment
Pull Request Description
Maps to acceptance criteria:

"New owner_member_id, distinct from created_by" → migration, created_by never touched.
"Groups list displays owner by name" → GroupsTable.tsx's new Owner column, resolved via page.tsx's member-name map.
"Leader-tier sees all, edits only owned" → API RBAC widened to requireLeader with an ownership check in PATCH; page-level gate deliberately untouched, per explicit scope.
"Deactivation blocked while owning groups" → new trigger, mirrors Pastoral Leader precedent exactly.
"Bulk + single reassignment, Admin-only" → both new endpoints, mirroring bulk-reassign-leader precedent.
"My Groups / All Groups split" → GroupsTable.tsx, two sections with a divider.
"created_by never reassigned" → confirmed untouched anywhere in this DIP.

Jira Linkage

PDEEpicID: FP-8 (EPIC-2 — Member & Group Management)
PDEStoryID: FP-146

Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-146.md, frozen after save. npm run build must pass cleanly. Validate the migration locally via supabase db reset before opening the PR. Open PR against dev, do not merge. Flag the manual remote-migration-apply step explicitly in the PR description — this one adds a new trigger every future member-deactivation will run through, worth Joseph's extra attention.
Include full diffs for every file in the completion report — given the size, expect this to be substantial.
