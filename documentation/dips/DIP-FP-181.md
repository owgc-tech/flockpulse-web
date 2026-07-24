-- DIP-FP-181: system-managed "Everyone" group, one per tenant.

Introduces a system-managed “Everyone” group, one per tenant. Every member automatically joins it the moment they become Active (invite acceptance or founding-admin registration), and automatically leaves it the moment they’re deactivated — as part of the same transaction, not a follow-up step. Manual removal from Everyone is blocked while a member is Active; renaming or deleting the Everyone group is blocked for every role, including Admin, at the database level — not just hidden in the UI.

Repo Target

Web (Next.js), owgc-tech/flockpulse-web. Backend/migration + service-layer work; no dedicated new screen.

Grounding Check

	•	Group membership confirmed live: assignments rows with assignment_type = 'GROUP', group_id FK, partial unique index idx_assignments_unique_active_group on (member_id, group_id) WHERE deleted_at IS NULL AND assignment_type = 'GROUP'.
	•	Identifying “the tenant’s Everyone group” needs a real marker, not a name match — an admin could otherwise create an unrelated group also literally named “Everyone,” which would break any lookup keyed on name. Adding groups.system_key TEXT (CHECK (system_key IS NULL OR system_key = 'EVERYONE')), with a partial unique index guaranteeing exactly one per tenant.
	•	Member-creation path is generalized, not hardcoded into one function: confirmed by reading both complete_registration() (invite acceptance) and create_tenant_and_founding_admin() (founder registration) directly — both INSERT INTO members, neither currently does any group assignment. An AFTER INSERT ON members trigger adding the new member to their tenant’s Everyone group covers both paths (and any future one) structurally, rather than needing two separate hardcoded edits.
	•	Tenant-creation path is generalized the same way: no AFTER INSERT ON tenants trigger exists today; create_tenant_and_founding_admin() is the only current path. An AFTER INSERT ON tenants trigger creating the Everyone group covers that path now and any self-serve provisioning path later, satisfying that AC without needing to know what a future provisioning flow will look like.
	•	Deactivation cascade confirmed structurally atomic, not incidentally: softDeleteMember() is a single UPDATE members SET deleted_at = now(); a new AFTER UPDATE ON members trigger (firing on the same OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL transition the existing guard triggers already use) does the Everyone-removal inside that same transaction. Postgres transaction isolation is what actually satisfies the “no race condition” AC here — a concurrent reader either sees the fully-pre-deactivation state or the fully-post-deactivation state, never a half-updated one, because both writes commit together.
	•	“Invite/broadcast flow that targets Everyone” — confirmed there’s no dedicated mass-broadcast feature in this codebase yet. The one real existing mechanism that targets group membership is handle_event_scheduling(), which pulls event attendees from assignments WHERE assignment_type = 'GROUP' AND deleted_at IS NULL — already active-only by construction. Once the deactivation cascade removes the Everyone row, that mechanism automatically stops reaching the deactivated member; no additional code is needed for a feature that doesn’t exist yet, and this one is verified against the actual consumer, not just asserted.
	•	The manual-removal guard and the deactivation cascade perform the identical SQL operation (soft-delete a GROUP assignment row), so a trigger can’t distinguish them by shape alone — it needs to know why the write is happening. Using set_config('app.bypass_system_group_guard', 'true', true) (transaction-local) inside the cascade trigger immediately before its own write, checked by the guard trigger, cleanly separates “sanctioned cascade” from “manual API-driven removal” without needing any change to the manual-removal code path itself to “opt out.”
	•	Error-mapping matches the existing house convention exactly — confirmed by reading MemberEditForm.tsx and members/service.ts directly: guard-trigger exceptions use a RAISE EXCEPTION 'CODE: message' convention, mapped in TS by error.code === 'P0001' + message-substring match, surfaced as HTTP 409 with a matching error code, displayed reactively (not via a proactively-disabled button). New code SYSTEM_MANAGED_GROUP follows this pattern precisely for both the group-rename/delete guard and the manual-removal guard.
	•	GroupEditForm.tsx’s existing generic error display already surfaces body.error.message with no special-casing — confirmed by reading it directly. No UI file changes are needed for the manual-removal guard to show up correctly; a clean message from the API is sufficient.
	•	Deliberately not in scope, flagged explicitly rather than silently skipped: not excluding “Everyone” from any group-picker dropdown (invitation creation, manual assignment) — the ON CONFLICT ... DO NOTHING guard on the member-insert trigger makes it harmless if it’s ever selected there anyway; not hiding the Everyone group from the Groups list or its Edit page — consistent with every other guard in this codebase being reactive, not proactively hidden; not blocking owner_member_id reassignment on the Everyone group, since it was never assigned one (NULL, no human owner) and nothing in the AC asks for that.

Implementation Plan

	1.	Migration — schema: groups.system_key TEXT with a CHECK and a partial unique index scoping one system group per tenant per key.
	2.	Migration — backfill: insert one Everyone group per existing tenant (idempotent via WHERE NOT EXISTS), then backfill every currently-Active member into it (idempotent via the existing partial unique index as the ON CONFLICT target).
	3.	Migration — AFTER INSERT ON tenants trigger: creates the Everyone group for any newly inserted tenant row, covering create_tenant_and_founding_admin() today and any future provisioning path generically.
	4.	Migration — AFTER INSERT ON members trigger: adds the new member to their tenant’s Everyone group, ON CONFLICT DO NOTHING against the existing partial unique index (defends against the edge case of an invitation’s own group_id happening to be the Everyone group itself). Covers complete_registration() and create_tenant_and_founding_admin() generically.
	5.	Migration — AFTER UPDATE ON members cascade trigger: on the deactivation transition, sets the transaction-local bypass flag, then soft-deletes the member’s Everyone-group assignment row, within the same transaction as the deactivation itself.
	6.	Migration — BEFORE UPDATE ON assignments guard trigger: blocks any soft-delete of a system-group GROUP assignment unless the bypass flag is set; raises 'SYSTEM_MANAGED_GROUP: cannot remove a member from a system-managed group while active'.
	7.	Migration — BEFORE UPDATE ON groups guard trigger: blocks a rename (NEW.name IS DISTINCT FROM OLD.name) or a soft-delete (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL) of any group where OLD.system_key IS NOT NULL, for any role, via any path — raises 'SYSTEM_MANAGED_GROUP: cannot rename or delete a system-managed group'. This fires regardless of whether the write comes from update_group_with_audit()/soft_delete_group_with_audit() or a hypothetical direct client update, since it’s on the table itself.
	8.	src/features/assignments/service.ts: softDeleteAssignment() gains the same error.code === 'P0001' + message-substring mapping convention already used elsewhere, mapping to { code: 'SYSTEM_MANAGED_GROUP' }.
	9.	src/features/groups/service.ts: updateGroup() and softDeleteGroup() each gain the same mapping, alongside their existing NOT_FOUND_IN_TENANT handling.
	10.	API routes: app/api/assignments/route.ts’s DELETE handler gains a try/catch (none exists today) mapping SYSTEM_MANAGED_GROUP → 409, matching the exact status code the existing INVALID_STATE_TRANSITION convention uses. app/api/groups/route.ts’s existing PATCH/DELETE try/catch blocks each gain an additional branch for the same code/status, alongside their existing NOT_FOUND_IN_TENANT handling.
	11.	No UI file changes — GroupEditForm.tsx’s existing generic body.error.message display already surfaces this correctly.

Files to Create/Modify

	•	supabase/migrations/20260727000061_everyone_system_group.sql (new)
	•	src/features/assignments/service.ts (modify — softDeleteAssignment only)
	•	src/features/groups/service.ts (modify — updateGroup and softDeleteGroup only)
	•	app/api/assignments/route.ts (modify — DELETE handler only)
	•	app/api/groups/route.ts (modify — PATCH and DELETE handlers only)

Migration Files

-- DIP-FP-181: system-managed "Everyone" group, one per tenant. Every member
-- auto-joins on becoming Active (invite acceptance or founder registration —
-- both generalized via AFTER INSERT ON members, not hardcoded per-function),
-- auto-leaves on deactivation (same transaction, via AFTER UPDATE ON members,
-- mirroring the existing FP-29 guard trigger's own deactivation-transition
-- check). Rename/delete blocked server-side for every role via a trigger on
-- groups itself, not just hidden in the UI. Manual removal blocked while
-- Active via a trigger on assignments, distinguished from the sanctioned
-- deactivation cascade by a transaction-local bypass flag.

-- ==============================================================
-- SECTION 1: schema — system_key marker + one-per-tenant guarantee
-- ==============================================================

ALTER TABLE groups ADD COLUMN IF NOT EXISTS system_key TEXT;

ALTER TABLE groups DROP CONSTRAINT IF EXISTS groups_system_key_check;
ALTER TABLE groups
    ADD CONSTRAINT groups_system_key_check
    CHECK (system_key IS NULL OR system_key = 'EVERYONE');

CREATE UNIQUE INDEX IF NOT EXISTS idx_groups_unique_system_key_per_tenant
    ON groups(tenant_id, system_key)
    WHERE system_key IS NOT NULL AND deleted_at IS NULL;


-- ==============================================================
-- SECTION 2: backfill — one Everyone group per existing tenant,
-- then every currently-Active member into it. Both idempotent.
-- ==============================================================

INSERT INTO groups (tenant_id, name, system_key, created_by)
SELECT t.id, 'Everyone', 'EVERYONE', NULL
FROM tenants t
WHERE NOT EXISTS (
    SELECT 1 FROM groups g WHERE g.tenant_id = t.id AND g.system_key = 'EVERYONE'
);

INSERT INTO assignments (tenant_id, member_id, group_id, assignment_type)
SELECT m.tenant_id, m.id, g.id, 'GROUP'
FROM members m
JOIN groups g ON g.tenant_id = m.tenant_id AND g.system_key = 'EVERYONE' AND g.deleted_at IS NULL
WHERE m.deleted_at IS NULL
ON CONFLICT (member_id, group_id) WHERE deleted_at IS NULL AND assignment_type = 'GROUP'
DO NOTHING;


-- ==============================================================
-- SECTION 3: new tenants get an Everyone group automatically
-- ==============================================================

CREATE OR REPLACE FUNCTION public.create_everyone_group_for_new_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  INSERT INTO groups (tenant_id, name, system_key, created_by)
  VALUES (NEW.id, 'Everyone', 'EVERYONE', NULL);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_create_everyone_group_for_new_tenant ON tenants;
CREATE TRIGGER trigger_create_everyone_group_for_new_tenant
AFTER INSERT ON tenants
FOR EACH ROW EXECUTE FUNCTION create_everyone_group_for_new_tenant();


-- ==============================================================
-- SECTION 4: new members auto-join their tenant's Everyone group
-- ==============================================================

CREATE OR REPLACE FUNCTION public.add_new_member_to_everyone_group()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE v_everyone_group_id UUID;
BEGIN
  IF NEW.deleted_at IS NULL THEN
    SELECT id INTO v_everyone_group_id
    FROM groups WHERE tenant_id = NEW.tenant_id AND system_key = 'EVERYONE' AND deleted_at IS NULL;

    IF v_everyone_group_id IS NOT NULL THEN
      INSERT INTO assignments (tenant_id, member_id, group_id, assignment_type)
      VALUES (NEW.tenant_id, NEW.id, v_everyone_group_id, 'GROUP')
      ON CONFLICT (member_id, group_id) WHERE deleted_at IS NULL AND assignment_type = 'GROUP'
      DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_add_new_member_to_everyone_group ON members;
CREATE TRIGGER trigger_add_new_member_to_everyone_group
AFTER INSERT ON members
FOR EACH ROW EXECUTE FUNCTION add_new_member_to_everyone_group();


-- ==============================================================
-- SECTION 5: deactivation removes the member from Everyone,
-- same transaction as softDeleteMember's own UPDATE.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.remove_member_from_everyone_group_on_deactivation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    PERFORM set_config('app.bypass_system_group_guard', 'true', true);

    UPDATE assignments
    SET deleted_at = now()
    WHERE assignments.tenant_id = NEW.tenant_id
      AND assignments.member_id = NEW.id
      AND assignments.assignment_type = 'GROUP'
      AND assignments.deleted_at IS NULL
      AND EXISTS (
        SELECT 1 FROM groups g
        WHERE g.id = assignments.group_id AND g.system_key = 'EVERYONE'
      );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_remove_member_from_everyone_group_on_deactivation ON members;
CREATE TRIGGER trigger_remove_member_from_everyone_group_on_deactivation
AFTER UPDATE ON members
FOR EACH ROW EXECUTE FUNCTION remove_member_from_everyone_group_on_deactivation();


-- ==============================================================
-- SECTION 6: block manual removal from a system group while Active
-- — distinguished from the sanctioned cascade above via the
-- transaction-local bypass flag it sets immediately before its write.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.block_manual_removal_from_system_group()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE v_is_system BOOLEAN;
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL AND NEW.assignment_type = 'GROUP' THEN
    IF current_setting('app.bypass_system_group_guard', true) IS DISTINCT FROM 'true' THEN
      SELECT (system_key IS NOT NULL) INTO v_is_system FROM groups WHERE id = NEW.group_id;
      IF v_is_system THEN
        RAISE EXCEPTION 'SYSTEM_MANAGED_GROUP: cannot remove a member from a system-managed group while active';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_block_manual_removal_from_system_group ON assignments;
CREATE TRIGGER trigger_block_manual_removal_from_system_group
BEFORE UPDATE ON assignments
FOR EACH ROW EXECUTE FUNCTION block_manual_removal_from_system_group();


-- ==============================================================
-- SECTION 7: block rename/delete of a system group, any role, any path
-- ==============================================================

CREATE OR REPLACE FUNCTION public.block_system_group_rename_or_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF OLD.system_key IS NOT NULL THEN
    IF NEW.name IS DISTINCT FROM OLD.name THEN
      RAISE EXCEPTION 'SYSTEM_MANAGED_GROUP: cannot rename or delete a system-managed group';
    END IF;
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
      RAISE EXCEPTION 'SYSTEM_MANAGED_GROUP: cannot rename or delete a system-managed group';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_block_system_group_rename_or_delete ON groups;
CREATE TRIGGER trigger_block_system_group_rename_or_delete
BEFORE UPDATE ON groups
FOR EACH ROW EXECUTE FUNCTION block_system_group_rename_or_delete();

Pull Request Description

Map each item explicitly:

	•	“One Everyone group per existing tenant, backfilled with currently-Active members” → Section 2.
	•	“New tenants get one too” → Section 3, generalized via AFTER INSERT ON tenants, not hardcoded into the founder-registration function.
	•	“Auto-join on invite acceptance” → Section 4, generalized via AFTER INSERT ON members, also covers founder registration.
	•	“Manual remove blocked while Active” → Section 6, HTTP 409 / SYSTEM_MANAGED_GROUP, matching the existing INVALID_STATE_TRANSITION convention’s status code exactly.
	•	“Deactivation removes from Everyone, same transaction” → Section 5.
	•	“Broadcast-to-Everyone never reaches a deactivated member” → satisfied by Section 5 plus the existing handle_event_scheduling()’s already-active-only read; no dedicated broadcast feature exists yet to touch.
	•	“Rename/delete blocked server-side, all roles, any path” → Section 7, a trigger on groups itself, not an app-layer check any single code path could bypass.
	•	Include, in the completion report, confirmation that GroupEditForm.tsx was deliberately left untouched, and why (its existing generic error display already handles this).

Jira Linkage

	•	PDEEpicID: FP-8
	•	PDEStoryID: FP-181

Stop Point

Save this DIP verbatim to documentation/dips/DIP-FP-181.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against dev and stop. Do not merge — the user will check out the branch locally, test it, and merge manually.

Include full diffs for every file in the completion report, no elisions.
