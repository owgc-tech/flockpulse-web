-- DIP-FP-192-web: tenant-configurable role catalog for all three access tiers.
-- role_catalog is a new, tenant-owned table of display names, seeded verbatim
-- with today's 7 hardcoded role options so no tenant's dropdown or displayed
-- titles change on cutover. members.role/invitations.role and every RBAC
-- check (ROLE_HIERARCHY, caller_is_admin(), caller_member_is_leader_or_admin(),
-- the CHECK constraints) are completely untouched — this is a display layer,
-- not a new access model. Going forward, catalog-driven writes set role to
-- the entry's generic tier value (ADMIN/LEADER/MEMBER); existing rows keep
-- their current specific literal until an admin re-saves them.
--
-- Confirmed live before writing this: members_role_check/invitations_role_check
-- (20260715000038_expand_role_model.sql) already allow all 7 literals
-- ('ADMIN','LEADER','MEMBER','SR_COORDINATOR','COORDINATOR','COMMUNITY_SERVANT',
-- 'PASTORAL_LEADER') — writing only the 3 generic values going forward is a
-- deliberate consolidation within that already-permitted superset, not a
-- constraint change.
--
-- Design gap filled beyond the DIP's literal schema sketch: the DIP requires
-- the seeded 7 to render in their exact original order (not alphabetical),
-- but "mirrors tasks" (which has no ordering column) can't guarantee that —
-- inserting all 7 rows in one statement gives them identical created_at
-- values, leaving only a random UUID as tiebreaker. Added sort_order INTEGER
-- to make the required order actually stable. New tenant-created entries
-- default to appending after the current max.
--
-- Also added beyond the DIP's literal migration wording: an AFTER INSERT ON
-- tenants trigger auto-provisioning the same 7 rows for any tenant created
-- after this migration runs — the DIP's own "Seed"/"Backfill" steps only
-- cover existing tenants. Without this, MemberEditForm/InviteForm's dropdowns
-- (which this DIP changes to source options from the catalog, not hardcoded
-- literals) would render empty for any future tenant. Mirrors the exact
-- precedent already established for groups' Everyone (FP-181) and event_types'
-- Announcement (FP-191) system rows.

-- ==============================================================
-- SECTION 1: role_catalog table.
-- ==============================================================

CREATE TABLE IF NOT EXISTS role_catalog (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    tier TEXT NOT NULL CHECK (tier IN ('ADMIN', 'LEADER', 'MEMBER')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE role_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenants can access their own role catalog" ON role_catalog USING (tenant_id = get_tenant_id());

CREATE UNIQUE INDEX IF NOT EXISTS idx_role_catalog_unique_name
    ON role_catalog(tenant_id, name) WHERE deleted_at IS NULL;


-- ==============================================================
-- SECTION 2: role_catalog_entry_id on members and invitations.
-- ==============================================================

ALTER TABLE members ADD COLUMN IF NOT EXISTS role_catalog_entry_id UUID REFERENCES role_catalog(id);
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS role_catalog_entry_id UUID REFERENCES role_catalog(id);


-- ==============================================================
-- SECTION 3: cross-tenant referential safety — a plain FK only guarantees
-- the row exists somewhere, not that it belongs to the same tenant as the
-- member/invitation referencing it. Mirrors the tenant-scope guard pattern
-- already used elsewhere in this codebase (e.g. FP-161-2's prayer-leader
-- tenant-scope trigger).
-- ==============================================================

CREATE OR REPLACE FUNCTION public.validate_member_role_catalog_entry_tenant_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.role_catalog_entry_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM role_catalog rc WHERE rc.id = NEW.role_catalog_entry_id AND rc.tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'CROSS_TENANT_ACCESS: role_catalog_entry_id does not belong to this tenant';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_validate_member_role_catalog_entry_tenant_scope ON members;
CREATE TRIGGER trigger_validate_member_role_catalog_entry_tenant_scope
BEFORE INSERT OR UPDATE ON members
FOR EACH ROW EXECUTE FUNCTION validate_member_role_catalog_entry_tenant_scope();

CREATE OR REPLACE FUNCTION public.validate_invitation_role_catalog_entry_tenant_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.role_catalog_entry_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM role_catalog rc WHERE rc.id = NEW.role_catalog_entry_id AND rc.tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'CROSS_TENANT_ACCESS: role_catalog_entry_id does not belong to this tenant';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_validate_invitation_role_catalog_entry_tenant_scope ON invitations;
CREATE TRIGGER trigger_validate_invitation_role_catalog_entry_tenant_scope
BEFORE INSERT OR UPDATE ON invitations
FOR EACH ROW EXECUTE FUNCTION validate_invitation_role_catalog_entry_tenant_scope();


-- ==============================================================
-- SECTION 4: delete-block trigger — mirrors softDeleteMember()'s Pastoral
-- Leader guard's exact message-with-count convention (P0001 + message
-- substring, parsed count(s)). Only fires on the soft-delete transition —
-- renames are always allowed, per the DIP's explicit "only name can be
-- renamed... tier is not editable" design (tier immutability is enforced at
-- the service layer, not here, since it's a business rule about when editing
-- is allowed, not a data-integrity invariant this trigger needs to police).
-- ==============================================================

CREATE OR REPLACE FUNCTION public.block_role_catalog_entry_delete_while_in_use()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_member_count INTEGER;
  v_invitation_count INTEGER;
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    SELECT count(*) INTO v_member_count FROM members WHERE role_catalog_entry_id = OLD.id AND deleted_at IS NULL;
    SELECT count(*) INTO v_invitation_count FROM invitations WHERE role_catalog_entry_id = OLD.id AND status = 'PENDING';
    IF v_member_count > 0 OR v_invitation_count > 0 THEN
      RAISE EXCEPTION 'ROLE_CATALOG_ENTRY_IN_USE: assigned to % member(s) and % pending invitation(s)', v_member_count, v_invitation_count;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_block_role_catalog_entry_delete_while_in_use ON role_catalog;
CREATE TRIGGER trigger_block_role_catalog_entry_delete_while_in_use
BEFORE UPDATE ON role_catalog
FOR EACH ROW EXECUTE FUNCTION block_role_catalog_entry_delete_while_in_use();


-- ==============================================================
-- SECTION 5: seed — exactly the 7 rows MemberEditForm.tsx/InviteForm.tsx
-- already hardcode, verbatim names/order/tiers, one set per existing tenant.
-- Idempotent via WHERE NOT EXISTS (name-scoped, matching the unique index).
-- ==============================================================

INSERT INTO role_catalog (tenant_id, name, tier, sort_order)
SELECT t.id, seed.name, seed.tier, seed.sort_order
FROM tenants t
CROSS JOIN (VALUES
    ('Member',            'MEMBER', 1),
    ('Pastoral Leader',   'LEADER', 2),
    ('Leader',            'LEADER', 3),
    ('Community Servant', 'ADMIN',  4),
    ('Coordinator',       'ADMIN',  5),
    ('Sr. Coordinator',   'ADMIN',  6),
    ('Admin',             'ADMIN',  7)
) AS seed(name, tier, sort_order)
WHERE NOT EXISTS (
    SELECT 1 FROM role_catalog rc WHERE rc.tenant_id = t.id AND rc.name = seed.name
);


-- ==============================================================
-- SECTION 6: new tenants get the same 7 rows automatically. Coexists with
-- every other AFTER INSERT ON tenants trigger (FP-181's Everyone group,
-- FP-191's Announcement type) — Postgres fires every trigger registered for
-- that event, no conflict.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.create_role_catalog_for_new_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  INSERT INTO role_catalog (tenant_id, name, tier, sort_order) VALUES
    (NEW.id, 'Member',            'MEMBER', 1),
    (NEW.id, 'Pastoral Leader',   'LEADER', 2),
    (NEW.id, 'Leader',            'LEADER', 3),
    (NEW.id, 'Community Servant', 'ADMIN',  4),
    (NEW.id, 'Coordinator',       'ADMIN',  5),
    (NEW.id, 'Sr. Coordinator',   'ADMIN',  6),
    (NEW.id, 'Admin',             'ADMIN',  7);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_create_role_catalog_for_new_tenant ON tenants;
CREATE TRIGGER trigger_create_role_catalog_for_new_tenant
AFTER INSERT ON tenants
FOR EACH ROW EXECUTE FUNCTION create_role_catalog_for_new_tenant();


-- ==============================================================
-- SECTION 7: backfill — every existing members row, and every existing
-- PENDING invitations row (per the DIP's explicit "pending invitations"
-- scoping — ACCEPTED/REVOKED rows are left alone), gets role_catalog_entry_id
-- set from its current literal role, matched by name to the seeded row.
-- role itself is untouched — matches the DIP's explicit "no change to the
-- role column itself during backfill."
-- ==============================================================

UPDATE members m
SET role_catalog_entry_id = rc.id
FROM role_catalog rc
WHERE rc.tenant_id = m.tenant_id
  AND rc.deleted_at IS NULL
  AND m.role_catalog_entry_id IS NULL
  AND rc.name = CASE m.role
    WHEN 'MEMBER'            THEN 'Member'
    WHEN 'PASTORAL_LEADER'   THEN 'Pastoral Leader'
    WHEN 'LEADER'            THEN 'Leader'
    WHEN 'COMMUNITY_SERVANT' THEN 'Community Servant'
    WHEN 'COORDINATOR'       THEN 'Coordinator'
    WHEN 'SR_COORDINATOR'    THEN 'Sr. Coordinator'
    WHEN 'ADMIN'             THEN 'Admin'
  END;

UPDATE invitations i
SET role_catalog_entry_id = rc.id
FROM role_catalog rc
WHERE rc.tenant_id = i.tenant_id
  AND rc.deleted_at IS NULL
  AND i.role_catalog_entry_id IS NULL
  AND i.status = 'PENDING'
  AND rc.name = CASE i.role
    WHEN 'MEMBER'            THEN 'Member'
    WHEN 'PASTORAL_LEADER'   THEN 'Pastoral Leader'
    WHEN 'LEADER'            THEN 'Leader'
    WHEN 'COMMUNITY_SERVANT' THEN 'Community Servant'
    WHEN 'COORDINATOR'       THEN 'Coordinator'
    WHEN 'SR_COORDINATOR'    THEN 'Sr. Coordinator'
    WHEN 'ADMIN'             THEN 'Admin'
  END;


-- ==============================================================
-- SECTION 8: reassign_role_catalog_entry — atomically moves every active
-- members row and every PENDING invitations row off entry A onto entry B,
-- single transaction, same-tier only (validated inside the function). Exact
-- name/signature/scope as specified in the DIP's Implementation Plan —
-- no p_actor_member_id, no audit logging, since the DIP didn't ask for
-- either (unlike this codebase's *_with_audit convention elsewhere); see
-- PR description.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.reassign_role_catalog_entry(
    p_from_entry_id UUID,
    p_to_entry_id UUID,
    p_tenant_id UUID
)
RETURNS TABLE (members_reassigned INTEGER, invitations_reassigned INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_from_tier TEXT;
  v_to_tier TEXT;
  v_members_count INTEGER;
  v_invitations_count INTEGER;
BEGIN
  IF p_from_entry_id = p_to_entry_id THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: from and to entries must be different';
  END IF;

  SELECT tier INTO v_from_tier FROM role_catalog WHERE id = p_from_entry_id AND tenant_id = p_tenant_id;
  SELECT tier INTO v_to_tier FROM role_catalog WHERE id = p_to_entry_id AND tenant_id = p_tenant_id;

  IF v_from_tier IS NULL OR v_to_tier IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND_IN_TENANT: one or both role_catalog entries not found for this tenant';
  END IF;

  IF v_from_tier <> v_to_tier THEN
    RAISE EXCEPTION 'TIER_MISMATCH: cannot reassign across tiers (% -> %)', v_from_tier, v_to_tier;
  END IF;

  UPDATE members SET role_catalog_entry_id = p_to_entry_id
  WHERE role_catalog_entry_id = p_from_entry_id AND tenant_id = p_tenant_id AND deleted_at IS NULL;
  GET DIAGNOSTICS v_members_count = ROW_COUNT;

  UPDATE invitations SET role_catalog_entry_id = p_to_entry_id
  WHERE role_catalog_entry_id = p_from_entry_id AND tenant_id = p_tenant_id AND status = 'PENDING';
  GET DIAGNOSTICS v_invitations_count = ROW_COUNT;

  RETURN QUERY SELECT v_members_count, v_invitations_count;
END;
$$;


-- ==============================================================
-- SECTION 9: complete_registration() — copy role_catalog_entry_id from the
-- invitation to the new member row, alongside the existing role copy.
-- RETURNS TABLE shape unchanged (member_id, tenant_id, role, group_id) —
-- registration.service.ts's RegistrationResult doesn't consume
-- role_catalog_entry_id, so no DROP FUNCTION is needed here, only the INSERT
-- column list changes.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.complete_registration(
    p_first_name    TEXT,
    p_last_name     TEXT,
    p_gender        TEXT,
    p_marital_status TEXT,
    p_birthdate     DATE
)
RETURNS TABLE (member_id UUID, tenant_id UUID, role TEXT, group_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_invitation invitations%ROWTYPE;
    v_member_id  UUID;
BEGIN
    -- Validate inputs before touching any rows.
    IF p_gender NOT IN ('MALE', 'FEMALE') THEN
        RAISE EXCEPTION 'gender must be MALE or FEMALE';
    END IF;
    IF p_marital_status NOT IN ('SINGLE', 'MARRIED', 'WIDOWED', 'DIVORCED', 'SEPARATED') THEN
        RAISE EXCEPTION 'marital_status must be SINGLE, MARRIED, WIDOWED, DIVORCED, or SEPARATED';
    END IF;
    IF p_birthdate > CURRENT_DATE THEN
        RAISE EXCEPTION 'birthdate cannot be in the future';
    END IF;

    -- Lock the invitation row — serializes concurrent calls for the same invite.
    SELECT * INTO v_invitation
    FROM invitations
    WHERE auth_user_id = auth.uid() AND status = 'PENDING'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No pending invitation found for this account';
    END IF;

    -- Create the members row. tenant_id, role, and role_catalog_entry_id are
    -- sourced exclusively from the invitation — the client cannot influence any of them.
    INSERT INTO members (
        tenant_id, user_id, email,
        first_name, last_name, role, role_catalog_entry_id,
        gender, marital_status, birthdate
    )
    VALUES (
        v_invitation.tenant_id, auth.uid(), v_invitation.email,
        p_first_name, p_last_name, v_invitation.role, v_invitation.role_catalog_entry_id,
        p_gender, p_marital_status, p_birthdate
    )
    RETURNING id INTO v_member_id;

    -- Assign to group if the invitation specified one.
    IF v_invitation.group_id IS NOT NULL THEN
        INSERT INTO assignments (tenant_id, member_id, group_id, assignment_type)
        VALUES (v_invitation.tenant_id, v_member_id, v_invitation.group_id, 'GROUP');
    END IF;

    -- Mark the invitation consumed — prevents replay.
    UPDATE invitations
    SET status = 'ACCEPTED', responded_at = now()
    WHERE id = v_invitation.id;

    -- Audit trail via FP-48 infrastructure.
    PERFORM write_audit_log(
        v_invitation.tenant_id,
        'member',
        v_member_id,
        'register',
        v_member_id,
        NULL,
        to_jsonb((SELECT m FROM members m WHERE m.id = v_member_id))
    );

    RETURN QUERY
        SELECT v_member_id, v_invitation.tenant_id, v_invitation.role, v_invitation.group_id;
END;
$$;
