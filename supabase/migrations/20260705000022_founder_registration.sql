-- FP-101: Founder Self-Registration — New Tenant + Founding Admin
--
-- Creates an atomic function that:
--   1. Inserts a new tenants row (attendance_window_hours uses the column's DEFAULT 24).
--   2. Inserts the founder as a MEMBER row with role = 'ADMIN'.
--   3. Writes two audit log entries: entity_type=tenant/action=create and
--      entity_type=member/action=register.
--
-- Called authenticated as the founder (via their access_token), so auth.uid()
-- resolves to them. The two-step application layer writes app_metadata afterward
-- via the service-role Admin API (same pattern as complete_registration).

CREATE OR REPLACE FUNCTION public.create_tenant_and_founding_admin(
    p_community_name  TEXT,
    p_first_name      TEXT,
    p_last_name       TEXT,
    p_gender          TEXT,
    p_marital_status  TEXT,
    p_birthdate       DATE
)
RETURNS TABLE (tenant_id UUID, member_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_tenant_id UUID;
    v_member_id UUID;
    v_email     TEXT;
BEGIN
    -- Defensive duplicate-registration check. The members.user_id UNIQUE constraint
    -- would also block this, but a raw constraint violation gives a cryptic message.
    IF EXISTS (SELECT 1 FROM members WHERE user_id = auth.uid()) THEN
        RAISE EXCEPTION 'This account is already registered to a community';
    END IF;

    SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();

    -- Create the tenant. attendance_window_hours intentionally omitted — column DEFAULT 24 applies.
    INSERT INTO tenants (name)
    VALUES (p_community_name)
    RETURNING id INTO v_tenant_id;

    -- Create the founding admin member row.
    INSERT INTO members (
        tenant_id, user_id, email, first_name, last_name, role,
        gender, marital_status, birthdate
    )
    VALUES (
        v_tenant_id, auth.uid(), v_email, p_first_name, p_last_name, 'ADMIN',
        p_gender, p_marital_status, p_birthdate
    )
    RETURNING id INTO v_member_id;

    -- Two audit entries: one per mutated row (FP-48 granularity).
    -- Both use v_member_id as actor — written after member INSERT so the id is available.
    PERFORM write_audit_log(
        v_tenant_id, 'tenant', v_tenant_id, 'create',
        v_member_id, NULL,
        to_jsonb((SELECT t FROM tenants t WHERE t.id = v_tenant_id))
    );
    PERFORM write_audit_log(
        v_tenant_id, 'member', v_member_id, 'register',
        v_member_id, NULL,
        to_jsonb((SELECT m FROM members m WHERE m.id = v_member_id))
    );

    RETURN QUERY SELECT v_tenant_id, v_member_id;
END;
$$;

-- Grant execute to authenticated users so the founder can call this with their own JWT.
GRANT EXECUTE ON FUNCTION public.create_tenant_and_founding_admin(TEXT, TEXT, TEXT, TEXT, TEXT, DATE)
    TO authenticated;
