-- FP-254 part 1 (ADDITIVE; apply BEFORE the web code is merged): acceptance of the Terms of Service and
-- the Privacy Policy, confirmation of 18+, and registration functions that no longer take a birthdate.
--
-- 1. legal_document_versions: one row holding the effective dates of the two documents. Seeded with the
--    day this migration is applied (Toronto). If the deploy day differs from the day the documents take
--    effect, set the dates with ONE statement (do this before members start accepting):
--      UPDATE public.legal_document_versions
--         SET terms_effective_date = DATE 'YYYY-MM-DD', privacy_effective_date = DATE 'YYYY-MM-DD', updated_at = now()
--       WHERE id;
--    Changing a date makes every member's acceptance "required" again (one-time screen shows again).
-- 2. member_acceptances: one row per member per pair of effective dates. Kept after a member is removed.
--    Same-tenant trigger; rows are immutable (UPDATE refused); DELETE stays allowed (closing a Community
--    deletes its data by hand). No policies, nothing granted to anon or authenticated.
-- 3. member_acceptance_required() and record_member_acceptance(): service_role only.
-- 4. complete_registration() and create_tenant_and_founding_admin(): NEW signatures with p_confirm_18 and
--    p_accept_terms instead of p_birthdate. Each is the CURRENT definition (complete_registration:
--    20260806000065 section 9; create_tenant_and_founding_admin: 20260705000022, never redefined) with only
--    the birthdate lines replaced and the acceptance row written in the same function (atomic). The OLD
--    signatures stay until 20261121000091, so code that is still deployed keeps working until then.
-- 5. members_birthdate_required_when_active is dropped so a member can be created without a birthdate.
--    The column itself stays until 20261121000091.
-- Idempotent: safe to apply twice.

-- ==============================================================
-- SECTION 1: legal_document_versions (one row)
-- ==============================================================

CREATE TABLE IF NOT EXISTS public.legal_document_versions (
    id                    BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    terms_effective_date  DATE NOT NULL,
    privacy_effective_date DATE NOT NULL,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.legal_document_versions (id, terms_effective_date, privacy_effective_date)
VALUES (TRUE, (now() AT TIME ZONE 'America/Toronto')::date, (now() AT TIME ZONE 'America/Toronto')::date)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.legal_document_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.legal_document_versions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.legal_document_versions TO service_role;

-- ==============================================================
-- SECTION 2: member_acceptances
-- ==============================================================

CREATE TABLE IF NOT EXISTS public.member_acceptances (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id              UUID NOT NULL REFERENCES tenants(id),
    member_id              UUID NOT NULL REFERENCES members(id),
    terms_effective_date   DATE NOT NULL,
    privacy_effective_date DATE NOT NULL,
    confirmed_18_plus      BOOLEAN NOT NULL CHECK (confirmed_18_plus),
    accepted_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (member_id, terms_effective_date, privacy_effective_date)
);

CREATE INDEX IF NOT EXISTS idx_member_acceptances_member ON public.member_acceptances(member_id);

ALTER TABLE public.member_acceptances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.member_acceptances FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_acceptances TO service_role;

CREATE OR REPLACE FUNCTION public.validate_member_acceptance_tenant_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM members WHERE id = NEW.member_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'member_acceptances.member_id % does not belong to tenant %', NEW.member_id, NEW.tenant_id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.validate_member_acceptance_tenant_scope() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trigger_validate_member_acceptance_tenant_scope ON public.member_acceptances;
CREATE TRIGGER trigger_validate_member_acceptance_tenant_scope
BEFORE INSERT OR UPDATE ON public.member_acceptances
FOR EACH ROW EXECUTE FUNCTION public.validate_member_acceptance_tenant_scope();

CREATE OR REPLACE FUNCTION public.refuse_member_acceptance_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'member_acceptances rows cannot be changed';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.refuse_member_acceptance_update() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trigger_refuse_member_acceptance_update ON public.member_acceptances;
CREATE TRIGGER trigger_refuse_member_acceptance_update
BEFORE UPDATE ON public.member_acceptances
FOR EACH ROW EXECUTE FUNCTION public.refuse_member_acceptance_update();

-- ==============================================================
-- SECTION 3: member_acceptance_required(), record_member_acceptance()
-- ==============================================================

-- True when the member is active in that tenant and has no acceptance row matching BOTH current
-- effective dates. Unknown, removed or other-tenant member: false. No settings row: false (never
-- locks everyone out because of a missing row).
CREATE OR REPLACE FUNCTION public.member_acceptance_required(p_tenant_id UUID, p_member_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
           SELECT 1 FROM members m
           WHERE m.id = p_member_id AND m.tenant_id = p_tenant_id AND m.deleted_at IS NULL
         )
     AND EXISTS (SELECT 1 FROM legal_document_versions)
     AND NOT EXISTS (
           SELECT 1
           FROM member_acceptances a
           JOIN legal_document_versions v
             ON v.terms_effective_date = a.terms_effective_date
            AND v.privacy_effective_date = a.privacy_effective_date
           WHERE a.member_id = p_member_id AND a.tenant_id = p_tenant_id
         );
$$;

REVOKE EXECUTE ON FUNCTION public.member_acceptance_required(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_acceptance_required(UUID, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.record_member_acceptance(
  p_tenant_id UUID,
  p_member_id UUID,
  p_confirm_18 BOOLEAN
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_terms DATE;
  v_privacy DATE;
  v_accepted_at TIMESTAMPTZ;
BEGIN
  IF p_confirm_18 IS NOT TRUE THEN
    RAISE EXCEPTION 'You must confirm you are 18 or older' USING ERRCODE = 'FP422';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM members
    WHERE id = p_member_id AND tenant_id = p_tenant_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Member not found for this tenant' USING ERRCODE = 'FP404';
  END IF;

  SELECT terms_effective_date, privacy_effective_date INTO v_terms, v_privacy
  FROM legal_document_versions;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'legal_document_versions has no row';
  END IF;

  INSERT INTO member_acceptances (
    tenant_id, member_id, terms_effective_date, privacy_effective_date, confirmed_18_plus
  ) VALUES (
    p_tenant_id, p_member_id, v_terms, v_privacy, TRUE
  )
  ON CONFLICT (member_id, terms_effective_date, privacy_effective_date) DO NOTHING;

  SELECT accepted_at INTO v_accepted_at
  FROM member_acceptances
  WHERE member_id = p_member_id
    AND terms_effective_date = v_terms
    AND privacy_effective_date = v_privacy;

  RETURN v_accepted_at;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_member_acceptance(UUID, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_member_acceptance(UUID, UUID, BOOLEAN) TO service_role;

-- ==============================================================
-- SECTION 4: complete_registration() — new signature.
-- Copy of 20260806000065 section 9, changed ONLY: p_birthdate (parameter, future-date check, INSERT
-- column and value) replaced by p_confirm_18 / p_accept_terms, validated before any row is touched,
-- and the member_acceptances row written right after the member row, in this same function.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.complete_registration(
    p_first_name    TEXT,
    p_last_name     TEXT,
    p_gender        TEXT,
    p_marital_status TEXT,
    p_confirm_18    BOOLEAN,
    p_accept_terms  BOOLEAN
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
    IF p_confirm_18 IS NOT TRUE THEN
        RAISE EXCEPTION 'You must confirm you are 18 or older';
    END IF;
    IF p_accept_terms IS NOT TRUE THEN
        RAISE EXCEPTION 'You must accept the Terms of Service and the Privacy Policy';
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
        gender, marital_status
    )
    VALUES (
        v_invitation.tenant_id, auth.uid(), v_invitation.email,
        p_first_name, p_last_name, v_invitation.role, v_invitation.role_catalog_entry_id,
        p_gender, p_marital_status
    )
    RETURNING id INTO v_member_id;

    -- Record the acceptance (current effective dates) in the same transaction.
    INSERT INTO member_acceptances (
        tenant_id, member_id, terms_effective_date, privacy_effective_date, confirmed_18_plus
    )
    SELECT v_invitation.tenant_id, v_member_id, v.terms_effective_date, v.privacy_effective_date, TRUE
    FROM legal_document_versions v;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'legal_document_versions has no row';
    END IF;

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

-- Same grants as the existing function (20261004000075): closed to PUBLIC and anon; callable with
-- the registrant's own token (authenticated) and by service_role.
REVOKE EXECUTE ON FUNCTION public.complete_registration(TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_registration(TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN) TO authenticated, service_role;

-- ==============================================================
-- SECTION 5: create_tenant_and_founding_admin() — new signature.
-- Copy of 20260705000022 (current definition), changed ONLY in the same way.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.create_tenant_and_founding_admin(
    p_community_name  TEXT,
    p_description     TEXT,
    p_first_name      TEXT,
    p_last_name       TEXT,
    p_gender          TEXT,
    p_marital_status  TEXT,
    p_confirm_18      BOOLEAN,
    p_accept_terms    BOOLEAN
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
    IF p_confirm_18 IS NOT TRUE THEN
        RAISE EXCEPTION 'You must confirm you are 18 or older';
    END IF;
    IF p_accept_terms IS NOT TRUE THEN
        RAISE EXCEPTION 'You must accept the Terms of Service and the Privacy Policy';
    END IF;

    -- Defensive duplicate-registration check. The members.user_id UNIQUE constraint
    -- would also block this, but a raw constraint violation gives a cryptic message.
    IF EXISTS (SELECT 1 FROM members WHERE user_id = auth.uid()) THEN
        RAISE EXCEPTION 'This account is already registered to a community';
    END IF;

    SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();

    -- Create the tenant.
    -- attendance_window_hours intentionally omitted — column DEFAULT 24 applies.
    -- description is included; NULL is valid (founder may leave it blank).
    INSERT INTO tenants (name, description)
    VALUES (p_community_name, p_description)
    RETURNING id INTO v_tenant_id;

    -- Create the founding admin member row.
    INSERT INTO members (
        tenant_id, user_id, email, first_name, last_name, role,
        gender, marital_status
    )
    VALUES (
        v_tenant_id, auth.uid(), v_email, p_first_name, p_last_name, 'ADMIN',
        p_gender, p_marital_status
    )
    RETURNING id INTO v_member_id;

    -- Record the acceptance (current effective dates) in the same transaction.
    INSERT INTO member_acceptances (
        tenant_id, member_id, terms_effective_date, privacy_effective_date, confirmed_18_plus
    )
    SELECT v_tenant_id, v_member_id, v.terms_effective_date, v.privacy_effective_date, TRUE
    FROM legal_document_versions v;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'legal_document_versions has no row';
    END IF;

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

REVOKE EXECUTE ON FUNCTION public.create_tenant_and_founding_admin(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_tenant_and_founding_admin(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN) TO authenticated, service_role;

-- ==============================================================
-- SECTION 6: a member can be created without a birthdate
-- ==============================================================

ALTER TABLE public.members DROP CONSTRAINT IF EXISTS members_birthdate_required_when_active;
