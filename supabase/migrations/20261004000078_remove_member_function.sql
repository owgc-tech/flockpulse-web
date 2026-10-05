-- FP-235-web: removing a member deletes their login and identifying details.
--
-- Product decision: when a member is removed for ANY reason, FlockPulse must not
-- keep information that identifies them — but the members row and its primary key
-- stay, so attendance / RSVPs / answers / talk completions / assignments are
-- never orphaned and keep counting in organization statistics.
--
-- remove_member() is the single database half of that, used by BOTH the admin
-- Remove action (reason DEACTIVATED) and the in-app account deletion (reason
-- SELF_DELETED). The caller then deletes the Auth login (src/features/members/
-- service.ts removeMember()). Order matters: this function runs first, so a
-- rejecting guard trigger aborts it and no login is ever deleted for a member who
-- was not actually removed.
--
-- What is kept vs removed on the members row:
--   removed / replaced  email -> 'deleted-<memberId>@deleted.invalid'
--                       first_name / last_name -> 'Self-deleted' / 'User'  (SELF_DELETED)
--                                              or 'Deactivated' / 'User'   (DEACTIVATED)
--                       birthdate -> January 1 of its own year (birth year only)
--   kept                gender, marital_status (real values, statistics),
--                       role, role_catalog_entry_id, mfa_trust_duration_days,
--                       created_at, user_id (an id, not an identifier of the person)
-- members has no phone or photo column (verified); a phone, if any, lives on the
-- Auth user and goes away with it.
--
-- Everything is ONE UPDATE of the members row, so the three BEFORE guard triggers
-- (assigned leader / owns groups / owns events) and the FP-234 AFTER prune trigger
-- fire on it exactly as they did for the old plain deactivation; a rejecting guard
-- rolls the whole function back.
--
-- Idempotent / retryable:
--   * already removed AND scrubbed  -> nothing on members changes (no label change,
--     and the birthdate cannot shift: Jan 1 of Jan 1's year is Jan 1), remaining
--     invitation rows are still scrubbed, user_id is returned again
--   * removed BEFORE this function existed (an admin Deactivate that left the name,
--     email and a live login) -> the identifying columns are scrubbed now, with the
--     ORIGINAL deleted_at kept as the removal date; the caller then deletes the login
--
-- Invitations: rows are never deleted (they carry invited_by and role history).
-- For that person (matched on auth_user_id, and on the original email within the
-- tenant) the email becomes the same placeholder and PENDING rows are revoked.
-- invitations.auth_user_id has no FK to auth.users, so deleting the login leaves it
-- as a dangling id, which identifies nobody.
--
-- Custom SQLSTATEs (the service maps them): FP404 not found in tenant,
-- FP422 invalid reason. Closed to PUBLIC/anon/authenticated, granted to
-- service_role only (FP-228 convention).

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
        birthdate = make_date(extract(year FROM birthdate)::int, 1, 1)
    WHERE id = p_member_id AND tenant_id = p_tenant_id;
  ELSIF v_email <> v_placeholder THEN
    -- Removed earlier by a plain deactivation that kept their details: finish the
    -- scrub, keeping the original deleted_at. No transition of deleted_at, so no
    -- guard or prune trigger is involved.
    UPDATE members
    SET email = v_placeholder,
        first_name = v_first,
        last_name = v_last,
        birthdate = make_date(extract(year FROM birthdate)::int, 1, 1)
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

  RETURN v_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.remove_member(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_member(UUID, UUID, TEXT) TO service_role;


-- ==============================================================
-- One-time relabel, idempotent. In-app deletes made before this change left
-- first_name 'Deleted' / last_name 'Member' (and a placeholder email) and replaced
-- gender / marital_status / birthdate with the fixed placeholders MALE / SINGLE /
-- 1990-01-01 — the real values cannot be recovered. They become 'Self-deleted' /
-- 'User'; their placeholder gender, marital status and birthdate are left as they
-- are (the count is reported below so reports can exclude them if needed).
--
-- Also scrubbed for those same people: the email still sitting on their
-- invitation rows (same rule remove_member() applies; PENDING rows revoked). The
-- match is by auth_user_id, so it can never touch anyone else's invitation.
-- A second run changes nothing (no member row matches 'Deleted'/'Member' any more,
-- and no invitation row still has a real email or PENDING status).
-- ==============================================================

DO $$
DECLARE
  v_relabelled INT;
  v_invites INT;
  v_total_legacy INT;
BEGIN
  WITH r AS (
    UPDATE members
    SET first_name = 'Self-deleted', last_name = 'User'
    WHERE email LIKE 'deleted-%@deleted.invalid'
      AND first_name = 'Deleted' AND last_name = 'Member'
    RETURNING 1
  )
  SELECT count(*) INTO v_relabelled FROM r;

  WITH i AS (
    UPDATE invitations inv
    SET email = m.email,
        status = CASE WHEN inv.status = 'PENDING' THEN 'REVOKED' ELSE inv.status END,
        responded_at = CASE WHEN inv.status = 'PENDING' THEN now() ELSE inv.responded_at END
    FROM members m
    WHERE m.tenant_id = inv.tenant_id
      AND m.user_id = inv.auth_user_id
      AND m.deleted_at IS NOT NULL
      AND m.email LIKE 'deleted-%@deleted.invalid'
      AND (inv.email <> m.email OR inv.status = 'PENDING')
    RETURNING 1
  )
  SELECT count(*) INTO v_invites FROM i;

  SELECT count(*) INTO v_total_legacy
  FROM members
  WHERE email LIKE 'deleted-%@deleted.invalid'
    AND gender = 'MALE' AND marital_status = 'SINGLE' AND birthdate = DATE '1990-01-01';

  RAISE NOTICE 'FP-235: relabelled % earlier in-app-deleted member row(s) to Self-deleted/User; scrubbed % of their invitation row(s); % removed member row(s) carry the placeholder gender/marital status/birthdate (MALE/SINGLE/1990-01-01)',
    v_relabelled, v_invites, v_total_legacy;
END
$$;
