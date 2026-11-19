-- DIP-FP-193-web: renames the "Pastoral Leader" member-assignment relationship
-- (who supervises this member) to "Assigned Leader" in user-facing copy only.
-- set_member_pastoral_leader() and the /api/members/:id/pastoral-leader route
-- path are deliberately not renamed (internal identifiers, no user-facing
-- text — confirmed: neither raises or returns any "Pastoral Leader" string).
--
-- Body/signature otherwise byte-identical to the live definition
-- (20260714000037_bulk_reassign_leader_and_deactivation_guard.sql) — only
-- the RAISE EXCEPTION message text changes. No DROP FUNCTION needed
-- (signature unchanged, CREATE OR REPLACE is sufficient). This message and
-- the substring match in src/features/members/service.ts that catches it
-- must ship together — see that file's own change in this same commit.

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
    FROM assignments
    WHERE leader_member_id = NEW.id
      AND assignment_type = 'LEADER'
      AND deleted_at IS NULL;

    IF v_count > 0 THEN
      RAISE EXCEPTION 'Cannot deactivate member %: still assigned as Assigned Leader to % member(s) — reassign them first', NEW.id, v_count;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
