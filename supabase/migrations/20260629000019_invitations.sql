-- FP-54: invitations table — tenant-scoped record of every Admin-issued invite.
-- Independent of auth.users (no tenant_id column there, not reachable via normal RLS surface).
-- status lifecycle: PENDING → ACCEPTED (on registration complete, FP-55) or REVOKED (future).
-- No hard-delete path — matches standing rule from migration 000003 onward.

CREATE TABLE IF NOT EXISTS invitations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email       TEXT NOT NULL,
    role        TEXT NOT NULL CHECK (role IN ('ADMIN', 'LEADER', 'MEMBER')),
    group_id    UUID REFERENCES groups(id) ON DELETE SET NULL,
    invited_by  UUID NOT NULL REFERENCES members(id),
    auth_user_id UUID NOT NULL,
    status      TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'REVOKED')),
    invited_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    responded_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_invitations_unique_pending_email
    ON invitations(tenant_id, email) WHERE status = 'PENDING';

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

-- ==============================================================
-- SECTION 2: Cross-tenant trigger for group_id
-- ==============================================================
-- group_id is nullable (Admin may invite without assigning a group).
-- When present, it must belong to the same tenant as the invitation.

CREATE OR REPLACE FUNCTION public.validate_invitation_group_tenant_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
BEGIN
    IF NEW.group_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM groups
            WHERE id = NEW.group_id AND tenant_id = NEW.tenant_id
        ) THEN
            RAISE EXCEPTION 'group_id % does not belong to tenant %', NEW.group_id, NEW.tenant_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_validate_invitation_group_tenant_scope ON invitations;
CREATE TRIGGER trigger_validate_invitation_group_tenant_scope
BEFORE INSERT OR UPDATE ON invitations
FOR EACH ROW EXECUTE FUNCTION validate_invitation_group_tenant_scope();

-- ==============================================================
-- SECTION 3: RLS policies — Admin-only read/write, tenant-scoped
-- ==============================================================

CREATE POLICY "invitations_admin_select" ON invitations
    FOR SELECT USING (tenant_id = get_tenant_id() AND caller_is_admin());

CREATE POLICY "invitations_admin_insert" ON invitations
    FOR INSERT WITH CHECK (tenant_id = get_tenant_id() AND caller_is_admin());

CREATE POLICY "invitations_admin_update" ON invitations
    FOR UPDATE
    USING (tenant_id = get_tenant_id() AND caller_is_admin())
    WITH CHECK (tenant_id = get_tenant_id() AND caller_is_admin());
