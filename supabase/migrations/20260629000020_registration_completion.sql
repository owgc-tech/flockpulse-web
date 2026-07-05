-- FP-55, FP-75, FP-88: Registration completion.
--
-- SECTION 1: Demographic columns on members (FP-75, FP-88)
-- ==============================================================
-- Added as NOT NULL — safe because migrations run before seed.sql in db reset,
-- so the table is empty at migration time. seed.sql supplies values for its rows.

ALTER TABLE members ADD COLUMN IF NOT EXISTS gender TEXT
    CHECK (gender IN ('MALE', 'FEMALE'));
ALTER TABLE members ADD COLUMN IF NOT EXISTS marital_status TEXT
    CHECK (marital_status IN ('SINGLE', 'MARRIED'));
ALTER TABLE members ADD COLUMN IF NOT EXISTS birthdate DATE;

ALTER TABLE members ALTER COLUMN gender SET NOT NULL;
ALTER TABLE members ALTER COLUMN marital_status SET NOT NULL;
ALTER TABLE members ALTER COLUMN birthdate SET NOT NULL;

-- ==============================================================
-- SECTION 2: Defense-in-depth RLS policy for members INSERT
-- ==============================================================
-- complete_registration() is SECURITY DEFINER and bypasses RLS — this policy
-- only applies to direct table INSERT. Mirrors the function's own check exactly:
-- user_id must be auth.uid() AND a PENDING invitation for that auth user must exist.

CREATE POLICY "members_registration_insert" ON members
    FOR INSERT WITH CHECK (
        user_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM invitations
            WHERE invitations.auth_user_id = auth.uid()
            AND invitations.status = 'PENDING'
        )
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
