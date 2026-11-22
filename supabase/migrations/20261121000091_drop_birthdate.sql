-- FP-254 part 2 (DESTRUCTIVE; apply AFTER the web code from part 1 is merged and deployed, and only after the
-- preview below has been run and confirmed). This PERMANENTLY DELETES every stored birthdate.
--
-- READ-ONLY PREVIEW — run this BEFORE applying (it errors once the column is gone, which is fine):
--   SELECT count(*) FILTER (WHERE deleted_at IS NULL) AS active_members,
--          count(*) FILTER (WHERE deleted_at IS NULL AND birthdate IS NOT NULL) AS active_with_birthdate,
--          count(*) FILTER (WHERE deleted_at IS NOT NULL AND birthdate IS NOT NULL) AS removed_with_birthdate,
--          count(*) FILTER (WHERE deleted_at IS NULL AND birthdate > current_date - interval '18 years') AS active_under_18
--   FROM members;
-- A member under 18 would be asked to confirm 18+ falsely: decide before applying.
--
-- 1. remove_member(): CREATE OR REPLACE of the CURRENT definition (20261120000087, section 2), changed ONLY by
--    deleting the "birthdate = NULL" lines in both UPDATEs. Same signature, return value, SECURITY DEFINER,
--    search_path and grants.
-- 2. The old complete_registration(TEXT,TEXT,TEXT,TEXT,DATE) and
--    create_tenant_and_founding_admin(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,DATE) are dropped (20261121000090 added the
--    new signatures).
-- 3. members.birthdate is dropped.
-- documentation/sql/FP-255-cleanup.sql is historical and must NOT be run after this migration.
-- Idempotent: safe to apply twice.

-- ==============================================================
-- SECTION 1: remove_member() — the 20261120000087 definition without the birthdate lines
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
-- SECTION 2: the old registration functions
-- ==============================================================

DROP FUNCTION IF EXISTS public.complete_registration(TEXT, TEXT, TEXT, TEXT, DATE);
DROP FUNCTION IF EXISTS public.create_tenant_and_founding_admin(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE);

-- ==============================================================
-- SECTION 3: the column
-- ==============================================================

ALTER TABLE public.members DROP COLUMN IF EXISTS birthdate;
