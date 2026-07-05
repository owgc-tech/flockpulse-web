-- FP-57: revoke_invitation() — atomic DB-side revoke (status + audit log).
--
-- Called by the application service AFTER deleteUser() succeeds (see service layer).
-- Ordering rationale (Grounding Check item 2):
--   deleteUser() first → if DB update fails, invite shows PENDING but Auth credential
--   is gone (safe: blocks registration). If DB updated first and deleteUser() then
--   fails, invite shows REVOKED but Auth credential exists (unsafe: appears revoked,
--   registration still possible). Fail toward the safe direction.
--
-- FOR UPDATE re-verifies status = 'PENDING' inside the transaction — guards against
-- a second Admin racing to revoke or the registrant completing registration in the
-- window between the service-layer early check and this atomic commit.

CREATE OR REPLACE FUNCTION public.revoke_invitation(
    p_invitation_id   UUID,
    p_admin_member_id UUID
)
RETURNS TABLE (invitation_id UUID, status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_invitation invitations%ROWTYPE;
BEGIN
    SELECT * INTO v_invitation
    FROM invitations
    WHERE id = p_invitation_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invitation not found';
    END IF;

    IF v_invitation.status <> 'PENDING' THEN
        RAISE EXCEPTION 'Only PENDING invitations can be revoked (current status: %)', v_invitation.status;
    END IF;

    UPDATE invitations
    SET status = 'REVOKED', responded_at = now()
    WHERE id = p_invitation_id;

    -- Audit trail: before = the original row snapshot, after = NULL (destructive action).
    PERFORM write_audit_log(
        v_invitation.tenant_id,
        'invitation',
        v_invitation.id,
        'revoke',
        p_admin_member_id,
        to_jsonb(v_invitation),
        NULL
    );

    RETURN QUERY SELECT v_invitation.id, 'REVOKED'::TEXT;
END;
$$;
