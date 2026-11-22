-- FP-255: removing a member (for any reason) also clears their gender, marital status and
-- BIRTHDATE, and the leftover login link (members.user_id) is cleared once the login is deleted.
--
-- Why: decided 2026-11-18 (Joseph, Harvey decision #10). In a small community gender and
-- marital status are the main way a removed person could still be recognised. This
-- SUPERSEDES the FP-235 / FP-237 rule "gender and marital status kept". Addendum
-- (Joseph, 2026-11-20): birthdate is cleared completely too, so the FP-235 reduction to
-- January 1 of the birth year no longer applies.
--
-- 1. Constraints. Active members still must have gender, marital_status, birthdate and user_id; a
--    removed member may have NULL. The column NOT NULL constraints are replaced by CHECKs
--    that only require the value while deleted_at IS NULL:
--      members_gender_required_when_active
--      members_marital_status_required_when_active
--      members_birthdate_required_when_active
--      members_user_id_required_when_active
--    members_user_id_key (UNIQUE) stays; a UNIQUE index allows several NULLs.
--    The existing value CHECKs (members_gender_check, members_marital_status_check) already
--    allow NULL. Each CHECK is added NOT VALID and then VALIDATEd, so an existing bad row
--    is reported by name.
-- 2. remove_member(): CREATE OR REPLACE of the CURRENT definition (20261006000083, section 6),
--    changed ONLY so that both UPDATEs (the normal path and the finish-the-scrub ELSIF path)
--    set birthdate = NULL (was: reduced to January 1) and also set gender = NULL,
--    marital_status = NULL. user_id is NOT nulled here:
--    removeMember() needs the returned id to delete the login, and a retry needs it if that
--    fails. Same signature, return value, SECURITY DEFINER, search_path and grants.
-- 3. clear_removed_member_login_link(): called by removeMember() AFTER the login is deleted.
-- FP-254 (on hold) must build on THIS definition of remove_member().
-- Idempotent: safe to apply twice.

-- ==============================================================
-- SECTION 1: constraints
-- ==============================================================

ALTER TABLE public.members ALTER COLUMN gender DROP NOT NULL;
ALTER TABLE public.members ALTER COLUMN marital_status DROP NOT NULL;
ALTER TABLE public.members ALTER COLUMN birthdate DROP NOT NULL;
ALTER TABLE public.members ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.members DROP CONSTRAINT IF EXISTS members_gender_required_when_active;
ALTER TABLE public.members ADD CONSTRAINT members_gender_required_when_active
  CHECK (gender IS NOT NULL OR deleted_at IS NOT NULL) NOT VALID;
ALTER TABLE public.members VALIDATE CONSTRAINT members_gender_required_when_active;

ALTER TABLE public.members DROP CONSTRAINT IF EXISTS members_marital_status_required_when_active;
ALTER TABLE public.members ADD CONSTRAINT members_marital_status_required_when_active
  CHECK (marital_status IS NOT NULL OR deleted_at IS NOT NULL) NOT VALID;
ALTER TABLE public.members VALIDATE CONSTRAINT members_marital_status_required_when_active;

ALTER TABLE public.members DROP CONSTRAINT IF EXISTS members_birthdate_required_when_active;
ALTER TABLE public.members ADD CONSTRAINT members_birthdate_required_when_active
  CHECK (birthdate IS NOT NULL OR deleted_at IS NOT NULL) NOT VALID;
ALTER TABLE public.members VALIDATE CONSTRAINT members_birthdate_required_when_active;

ALTER TABLE public.members DROP CONSTRAINT IF EXISTS members_user_id_required_when_active;
ALTER TABLE public.members ADD CONSTRAINT members_user_id_required_when_active
  CHECK (user_id IS NOT NULL OR deleted_at IS NOT NULL) NOT VALID;
ALTER TABLE public.members VALIDATE CONSTRAINT members_user_id_required_when_active;

-- ==============================================================
-- SECTION 2: remove_member() — the 20261006000083 definition plus
-- "gender = NULL, marital_status = NULL, birthdate = NULL" in its two UPDATEs (nothing else)
-- ==============================================================

CREATE OR REPLACE FUNCTION public.remove_member(
  p_tenant_id UUID,
  p_member_id UUID,
  p_reason TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id UUID;
  v_email TEXT;
  v_deleted_at TIMESTAMPTZ;
  v_placeholder TEXT := 'deleted-' || p_member_id::text || '@deleted.invalid';
  v_first TEXT;
  v_last TEXT;
  v_prev_bypass TEXT;
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN ('SELF_DELETED', 'DEACTIVATED') THEN
    RAISE EXCEPTION 'p_reason must be SELF_DELETED or DEACTIVATED' USING ERRCODE = 'FP422';
  END IF;

  SELECT user_id, email, deleted_at INTO v_user_id, v_email, v_deleted_at
  FROM members
  WHERE id = p_member_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member not found for this tenant' USING ERRCODE = 'FP404';
  END IF;

  IF p_reason = 'SELF_DELETED' THEN
    v_first := 'Self-deleted'; v_last := 'User';
  ELSE
    v_first := 'Deactivated';  v_last := 'User';
  END IF;

  IF v_deleted_at IS NULL THEN
    -- Normal removal: ONE update, so the guard triggers and the FP-234 prune fire.
    UPDATE members
    SET deleted_at = now(),
        email = v_placeholder,
        first_name = v_first,
        last_name = v_last,
        birthdate = NULL,
        gender = NULL,
        marital_status = NULL
    WHERE id = p_member_id AND tenant_id = p_tenant_id;
  ELSIF v_email <> v_placeholder THEN
    -- Removed earlier by a plain deactivation that kept their details: finish the
    -- scrub, keeping the original deleted_at. No transition of deleted_at, so no
    -- guard or prune trigger is involved.
    UPDATE members
    SET email = v_placeholder,
        first_name = v_first,
        last_name = v_last,
        birthdate = NULL,
        gender = NULL,
        marital_status = NULL
    WHERE id = p_member_id AND tenant_id = p_tenant_id;
  END IF;

  -- Invitation rows for this person. v_email is the ORIGINAL email unless the
  -- member row was already scrubbed (then only auth_user_id can match).
  UPDATE invitations
  SET email = v_placeholder,
      status = CASE WHEN status = 'PENDING' THEN 'REVOKED' ELSE status END,
      responded_at = CASE WHEN status = 'PENDING' THEN now() ELSE responded_at END
  WHERE tenant_id = p_tenant_id
    AND (auth_user_id = v_user_id
         OR (v_email <> v_placeholder AND lower(email) = lower(v_email)))
    AND (email <> v_placeholder OR status = 'PENDING');

  -- FP-237 (i): detach from their leader and from every group.
  v_prev_bypass := current_setting('app.bypass_system_group_guard', true);
  PERFORM set_config('app.bypass_system_group_guard', 'true', true);
  UPDATE assignments
  SET deleted_at = now()
  WHERE tenant_id = p_tenant_id AND member_id = p_member_id AND deleted_at IS NULL;
  PERFORM set_config('app.bypass_system_group_guard', COALESCE(v_prev_bypass, ''), true);

  -- FP-237 (ii): their unavailability.
  DELETE FROM member_unavailability_ranges
  WHERE tenant_id = p_tenant_id AND member_id = p_member_id;

  -- FP-222: their per-event "last viewed version" rows.
  DELETE FROM event_member_views
  WHERE tenant_id = p_tenant_id AND member_id = p_member_id;

  -- FP-236: their own words (RSVP reasons, self-report reasons and feedback, leader
  -- notes) become '[removed]', in the tables and in their audit entries.
  PERFORM public.redact_removed_member_personal_text(p_tenant_id, p_member_id);

  RETURN v_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.remove_member(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_member(UUID, UUID, TEXT) TO service_role;

-- ==============================================================
-- SECTION 3: clear_removed_member_login_link()
-- Called by removeMember() only AFTER auth.admin.deleteUser() has succeeded (or reported the
-- login already gone), so a failed login deletion can still be retried with user_id intact.
-- Only ever touches a REMOVED member of the given tenant.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.clear_removed_member_login_link(
  p_tenant_id UUID,
  p_member_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  UPDATE members
  SET user_id = NULL
  WHERE id = p_member_id
    AND tenant_id = p_tenant_id
    AND deleted_at IS NOT NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.clear_removed_member_login_link(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_removed_member_login_link(UUID, UUID) TO service_role;
