-- FP-73/FP-74: bulk Leader reassignment + deactivation guard blocking a still-assigned
-- Leader from being deactivated.
--
-- Confirmed live before writing this (per DIP-FP-73-FP-74's own explicit instructions):
--   - DIP-FP-69-FP-72-adj-1 was never executed — no such file exists in documentation/dips,
--     and validate_assignment_tenant()'s live body has no role IN ('LEADER','ADMIN') clause.
--     The incoming-Leader picker therefore stays "any active member," matching current
--     live behavior — not filtered to Leader/Admin roles.
--   - FP-29's precedent (block_talk_deletion_if_referenced(), migration 20260629000015):
--     a BEFORE UPDATE trigger on the referenced table itself, firing only on the
--     soft-delete transition (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL),
--     raising a plain descriptive exception (no embedded error-code prefix in the message).
--     The app layer (talk.service.ts) catches this via `code === 'P0001'` then
--     `msg.includes('Cannot soft-delete talk')` -> throws INVALID_STATE_TRANSITION.
--     This migration mirrors that exact shape for members/LEADER assignments — a DB-level
--     trigger, not an app-layer pre-check as the DIP's own "provisional default" assumed.
--   - set_member_pastoral_leader(p_member_id, p_leader_member_id, p_tenant_id,
--     p_actor_member_id)'s live signature is unchanged since Group A.
--   - members has no existing triggers (pg_trigger returned zero rows) — no conflict.

CREATE OR REPLACE FUNCTION public.bulk_reassign_leader_members_with_audit(
  p_outgoing_leader_id UUID,
  p_incoming_leader_id UUID,
  p_tenant_id UUID,
  p_actor_member_id UUID
)
RETURNS TABLE (reassigned_count INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE
  v_member_id UUID;
  v_count INT := 0;
BEGIN
  IF p_outgoing_leader_id = p_incoming_leader_id THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: outgoing and incoming leader must be different members';
  END IF;

  FOR v_member_id IN
    SELECT DISTINCT a.member_id
    FROM assignments a
    WHERE a.leader_member_id = p_outgoing_leader_id
      AND a.tenant_id = p_tenant_id
      AND a.assignment_type = 'LEADER'
      AND a.deleted_at IS NULL
  LOOP
    -- Reuses the exact same retire-old/insert-new logic as a single reassignment
    -- (Group A's set_member_pastoral_leader()) — per FP-73's own AC, no new mechanism.
    -- Its internal trigger validates p_incoming_leader_id on first use; any failure
    -- aborts this whole function's transaction.
    PERFORM set_member_pastoral_leader(v_member_id, p_incoming_leader_id, p_tenant_id, p_actor_member_id);
    v_count := v_count + 1;
  END LOOP;

  RETURN QUERY SELECT v_count;
END;
$$;


-- ==============================================================
-- FP-74 guard — mirrors block_talk_deletion_if_referenced() (FP-29) exactly: a BEFORE
-- UPDATE trigger firing only on the soft-delete transition, raising a plain descriptive
-- exception. The count is included in the message (a small enhancement over FP-29's
-- plain existence check) so the app layer can surface "N members still assigned."
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
    FROM assignments
    WHERE leader_member_id = NEW.id
      AND assignment_type = 'LEADER'
      AND deleted_at IS NULL;

    IF v_count > 0 THEN
      RAISE EXCEPTION 'Cannot deactivate member %: still assigned as Pastoral Leader to % member(s) — reassign them first', NEW.id, v_count;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_block_member_deactivation_if_assigned_leader ON members;
CREATE TRIGGER trigger_block_member_deactivation_if_assigned_leader
BEFORE UPDATE ON members
FOR EACH ROW EXECUTE FUNCTION block_member_deactivation_if_assigned_leader();
