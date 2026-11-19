-- FP-237-web: removed members leave no live links to anyone.
--
-- Product decision: records of removed (deactivated or self-deleted) members must
-- not stay attached to their leader and must not count toward the leader's assigned
-- members; their group memberships go too. Before this migration the leader guard
-- counted every LEADER assignment row of the leader without checking whether the
-- assigned member had been removed, so a leader could be blocked by people who no
-- longer exist anywhere an admin can see, with nothing to click to fix it.
--
-- What `assignments` columns mean (verified):
--   LEADER row:  member_id = the person being led; leader_member_id = their leader
--   GROUP  row:  member_id = the group member;     group_id = the group
-- "A removed member's own assignments rows" are the rows where member_id = that
-- member: their LEADER link (to their leader) and their GROUP memberships.
--
-- Changes:
--   A. remove_member()      also soft-deletes the member's assignments rows and deletes
--                           their unavailability rows — on EVERY branch, so a retry (or
--                           the cleanup below) completes a half-finished removal.
--   B. leader guard         counts only LEADER rows whose assigned member is not removed.
--                           The exception text is unchanged (the TypeScript mapping in
--                           src/features/members/service.ts matches its substrings).
--   C. validate_assignment_tenant()  now checks that the leader is active only for rows
--                           that are themselves active (see the note there).
--   D. one-time cleanup     the same detaching for members removed earlier; idempotent.
--
-- HISTORY is deliberately left alone (event attendees, RSVPs, attendance, answers,
-- talk completions, invited_by, audit actor ids ...) so an event's own totals and the
-- organization statistics never change. The classification table is in the PR.


-- ==============================================================
-- SECTION C first (it is a prerequisite for A and D): validate_assignment_tenant().
--
-- It rejects ANY insert/update of an assignment whose leader_member_id is not an
-- active member of the tenant — including an UPDATE that merely soft-deletes the row.
-- If a leader was removed before the leader guard existed, a row still pointing at
-- them could then never be soft-deleted (not by an admin, not by the removal of the
-- person it describes), and the cleanup below would abort the whole migration. The
-- active-leader requirement exists to stop NEW or live links to an inactive leader;
-- a row that is being soft-deleted (deleted_at set) creates no such link.
--
-- So the SAME-TENANT check on the leader still applies to EVERY row (cross-tenant
-- referential safety is never relaxed — a soft-deleted row may not reference a leader
-- in another tenant), and only the "leader must be active" requirement is relaxed, and
-- only for a row that is itself being soft-deleted (NEW.deleted_at IS NOT NULL).
-- Everything else is unchanged; every case that was rejected for an active row is still
-- rejected, and the exception text is unchanged.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.validate_assignment_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF NEW.group_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM groups g
      WHERE g.id = NEW.group_id AND g.tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'CROSS_TENANT_ACCESS: group_id % does not belong to tenant %', NEW.group_id, NEW.tenant_id;
    END IF;
  END IF;

  IF NEW.leader_member_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM members m
      WHERE m.id = NEW.leader_member_id
        AND m.tenant_id = NEW.tenant_id
        AND (NEW.deleted_at IS NOT NULL OR m.deleted_at IS NULL)
    ) THEN
      RAISE EXCEPTION 'CROSS_TENANT_ACCESS: leader_member_id % does not belong to tenant % or is inactive', NEW.leader_member_id, NEW.tenant_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;


-- ==============================================================
-- SECTION B: leader guard ignores removed members.
-- Counts only LEADER rows whose ASSIGNED member (assignments.member_id) is not removed,
-- so the number in the message is exactly the people an admin can still see and
-- reassign. The exception text is EXACTLY as before.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.block_member_deactivation_if_assigned_leader()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_count INT;
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    SELECT COUNT(*) INTO v_count
    FROM assignments a
    JOIN members m ON m.id = a.member_id AND m.deleted_at IS NULL
    WHERE a.leader_member_id = NEW.id
      AND a.assignment_type = 'LEADER'
      AND a.deleted_at IS NULL;

    IF v_count > 0 THEN
      RAISE EXCEPTION 'Cannot deactivate member %: still assigned as Assigned Leader to % member(s) — reassign them first', NEW.id, v_count;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


-- ==============================================================
-- SECTION A: remove_member() — FP-235's function, same signature, privileges,
-- labels, idempotency and every existing behavior, plus (new, after the invitation
-- scrub, on every branch):
--   (i)  soft-delete ALL of the member's own assignments rows (LEADER link + GROUP
--        memberships). The Everyone-group guard trigger needs its transaction-local
--        bypass flag for the system group's row (set and restored here; the existing
--        Everyone deactivation trigger already removes that row on the normal path, so
--        nothing is done twice — this only picks up what is left, e.g. on a retry).
--   (ii) delete their member_unavailability_ranges rows.
-- No other per-person table holds a live link (inventory in the PR).
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

  RETURN v_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.remove_member(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_member(UUID, UUID, TEXT) TO service_role;


-- ==============================================================
-- SECTION D: one-time cleanup for members removed earlier. Idempotent: it only
-- touches assignments rows that are still active and unavailability rows that still
-- exist, so a second run changes nothing. Counts are RAISE NOTICEd and can be
-- reproduced with the query in the PR (the SQL Editor may not show notices).
-- ==============================================================

DO $$
DECLARE
  v_prev_bypass TEXT := current_setting('app.bypass_system_group_guard', true);
  v_leaders_unblocked INT;
  v_leader_rows INT;
  v_group_rows INT;
  v_unavail INT;
BEGIN
  -- active leaders who were blocked ONLY by removed people (before this change)
  SELECT count(*) INTO v_leaders_unblocked
  FROM (
    SELECT a.leader_member_id
    FROM assignments a
    JOIN members m ON m.id = a.member_id
    WHERE a.assignment_type = 'LEADER' AND a.deleted_at IS NULL
    GROUP BY a.leader_member_id
    HAVING bool_and(m.deleted_at IS NOT NULL)
  ) x
  JOIN members l ON l.id = x.leader_member_id AND l.deleted_at IS NULL;

  PERFORM set_config('app.bypass_system_group_guard', 'true', true);

  WITH u AS (
    UPDATE assignments a
    SET deleted_at = now()
    FROM members m
    WHERE m.id = a.member_id AND m.deleted_at IS NOT NULL AND a.deleted_at IS NULL
    RETURNING a.assignment_type
  )
  SELECT count(*) FILTER (WHERE assignment_type = 'LEADER'),
         count(*) FILTER (WHERE assignment_type = 'GROUP')
  INTO v_leader_rows, v_group_rows FROM u;

  PERFORM set_config('app.bypass_system_group_guard', COALESCE(v_prev_bypass, ''), true);

  WITH d AS (
    DELETE FROM member_unavailability_ranges r
    USING members m
    WHERE m.id = r.member_id AND m.deleted_at IS NOT NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_unavail FROM d;

  RAISE NOTICE 'FP-237: detached removed members from their leader (% LEADER row(s)) and from groups (% GROUP row(s)); deleted % unavailability row(s); % active leader(s) were blocked only by removed people and are now free to be removed',
    v_leader_rows, v_group_rows, v_unavail, v_leaders_unblocked;
END
$$;
