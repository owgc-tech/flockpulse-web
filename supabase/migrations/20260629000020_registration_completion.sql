-- FP-55, FP-75, FP-88: Registration completion.
--
-- SECTION 1: Demographic columns on members (FP-75, FP-88)
-- ==============================================================
-- ADD COLUMN is nullable first so the statement succeeds on databases that
-- already have rows (fpdb-dev had test/seed members). The backfill step below
-- fills those rows before the NOT NULL constraint is applied.
-- On local db reset, members is always empty before this migration runs,
-- so the backfill is a no-op there — that's expected, not a sign of a problem.

ALTER TABLE members ADD COLUMN IF NOT EXISTS gender TEXT
    CHECK (gender IN ('MALE', 'FEMALE'));
ALTER TABLE members ADD COLUMN IF NOT EXISTS marital_status TEXT
    CHECK (marital_status IN ('SINGLE', 'MARRIED'));
ALTER TABLE members ADD COLUMN IF NOT EXISTS birthdate DATE;

-- Backfill: confirmed no real data anywhere in this project — fpdb-dev's existing
-- members rows are test/seed accounts only. Placeholder values match the convention
-- already used in seed.sql for local dev.
UPDATE members SET gender = 'MALE' WHERE gender IS NULL;
UPDATE members SET marital_status = 'SINGLE' WHERE marital_status IS NULL;
UPDATE members SET birthdate = '1990-01-01' WHERE birthdate IS NULL;

ALTER TABLE members ALTER COLUMN gender SET NOT NULL;
ALTER TABLE members ALTER COLUMN marital_status SET NOT NULL;
ALTER TABLE members ALTER COLUMN birthdate SET NOT NULL;

-- ==============================================================
-- SECTION 2: Defense-in-depth RLS policy for members INSERT
-- ==============================================================
-- complete_registration() is SECURITY DEFINER and bypasses RLS — this policy
-- only applies to direct table INSERT. Mirrors the function's own check exactly:
-- user_id must be auth.uid() AND a PENDING invitation for that auth user must exist.
--
-- The EXISTS subquery reads from invitations, which is also RLS-protected (admin-only
-- SELECT). A direct EXISTS inside WITH CHECK runs in the calling user's context and
-- cannot see through the invitations RLS, so it always returns false for non-admins.
-- We solve this with a SECURITY DEFINER helper that runs as postgres and bypasses
-- the invitations RLS entirely — keeping the policy tight while making it actually work.
--
-- invitations_select_self lets a registrant read their own invitation row (status
-- check, UI display); it is independent of the policy helper.

CREATE POLICY "invitations_select_self" ON invitations
    FOR SELECT USING (auth_user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.caller_has_pending_invitation()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
    SELECT EXISTS (
        SELECT 1 FROM invitations
        WHERE auth_user_id = auth.uid()
        AND status = 'PENDING'
    );
$$;

-- Note: the INSERT does not use .select() (the registrant has no tenant in
-- app_metadata, so get_tenant_id() = NULL and the SELECT policy blocks them from
-- reading back the row). Tests verify the row via direct psql query after INSERT.
CREATE POLICY "members_registration_insert" ON members
    FOR INSERT WITH CHECK (
        user_id = auth.uid()
        AND public.caller_has_pending_invitation()
    );

-- ==============================================================
-- SECTION 3: complete_registration() — atomic registration function
-- ==============================================================
-- Security model:
--   - SECURITY DEFINER: runs as postgres, bypasses RLS so it can INSERT
--     into members and assignments as an otherwise-unprivileged registrant.
--   - auth_user_id = auth.uid() lookup: the ONLY identity proof accepted.
--     tenant_id and role come exclusively from the invitation row — never
--     from function parameters or the client request body.
--   - FOR UPDATE on the invitation row: prevents two concurrent calls for
--     the same invite from both succeeding (second is serialized, sees
--     status='ACCEPTED', raises).

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
    IF p_marital_status NOT IN ('SINGLE', 'MARRIED') THEN
        RAISE EXCEPTION 'marital_status must be SINGLE or MARRIED';
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

    -- Create the members row. tenant_id and role are sourced exclusively from
    -- the invitation — the client cannot influence either value.
    INSERT INTO members (
        tenant_id, user_id, email,
        first_name, last_name, role,
        gender, marital_status, birthdate
    )
    VALUES (
        v_invitation.tenant_id, auth.uid(), v_invitation.email,
        p_first_name, p_last_name, v_invitation.role,
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
