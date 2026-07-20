-- DIP-FP-161-2: transferable Event Owner (owner_member_id), distinct from
-- the existing immutable created_by_member_id (added under FP-114-web).
-- Deactivation guard + single/bulk reassignment mirror FP-146's Group Owner
-- precedent (20260719000049_group_owner_transfer_and_deactivation_guard.sql)
-- as closely as events' actual schema allows — see deviations noted below.
--
-- Unlike Groups' create_group_with_audit, insert_event_with_audit() is NOT
-- touched here — owner_member_id is set via createEvent()'s existing
-- follow-up UPDATE in src/features/events/service.ts (the same one that
-- sets created_by_member_id today), per the DIP's explicit direction to
-- avoid the RETURNS TABLE signature churn touching that RPC would require.
--
-- Schema-driven deviations from the FP-146 precedent (confirmed live before
-- writing this, not assumed from groups' shape):
--   - events has no deleted_at column (status-based lifecycle, not
--     soft-delete) — every `AND deleted_at IS NULL` present in groups'
--     equivalent functions is simply absent here, not replaced with
--     anything: no soft-delete state exists on events to filter out.
--   - events has no updated_by column (groups does) — the UPDATE inside
--     reassign_event_owner_with_audit sets updated_at only, matching
--     update_event_with_audit()'s own column list.
--   - events.version exists (groups has no equivalent) but is NOT
--     incremented by this reassignment — FP-146's reassign_group_owner_
--     with_audit is the function being mirrored "exactly" per the DIP, and
--     it has no version-bump concept to carry over; version stays scoped to
--     update_event_with_audit()'s own optimistic-concurrency use, unchanged
--     by this DIP.
--
-- block_member_deactivation_if_owns_events is a new, independent trigger —
-- members already has two BEFORE UPDATE triggers (Pastoral Leader guard
-- from FP-73/74, Group Owner guard from FP-146) — this adds a third, per
-- the one-trigger-per-guard-reason convention, not a merge into either.

ALTER TABLE events ADD COLUMN IF NOT EXISTS owner_member_id UUID REFERENCES members(id);

-- Legacy-data fallback, preserved exactly per the Grounding Check: events
-- predating FP-114-web have created_by_member_id = NULL by design (no
-- backfill invented for those) — this backfill inherits that same NULL
-- where it exists, so a NULL owner_member_id continues to mean "Admin-tier
-- only can manage this event," unchanged from today's behavior.
UPDATE events SET owner_member_id = created_by_member_id WHERE owner_member_id IS NULL;

CREATE OR REPLACE FUNCTION public.reassign_event_owner_with_audit(
  p_event_id UUID, p_tenant_id UUID, p_new_owner_member_id UUID, p_actor_member_id UUID
)
RETURNS TABLE (id UUID, owner_member_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE v_old_owner UUID; v_row events%ROWTYPE; v_new_owner_valid BOOLEAN;
BEGIN
  SELECT e.owner_member_id INTO v_old_owner FROM events e
    WHERE e.id = p_event_id AND e.tenant_id = p_tenant_id;
  -- NOTE: this function's RETURNS TABLE(id UUID, ...) introduces an OUT parameter named
  -- `id`, so the EXISTS check below must alias-qualify e.id — a bare `id` here is ambiguous
  -- against that OUT parameter (same lesson already caught live for groups' equivalent, see
  -- 20260719000049's own comment).
  IF v_old_owner IS NULL AND NOT EXISTS (SELECT 1 FROM events e WHERE e.id = p_event_id AND e.tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'NOT_FOUND_IN_TENANT: event % not found in tenant %', p_event_id, p_tenant_id;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM members m WHERE m.id = p_new_owner_member_id AND m.tenant_id = p_tenant_id AND m.deleted_at IS NULL
  ) INTO v_new_owner_valid;
  IF NOT v_new_owner_valid THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: new owner % is not an active member of this tenant', p_new_owner_member_id;
  END IF;

  UPDATE events SET owner_member_id = p_new_owner_member_id, updated_at = now()
  WHERE events.id = p_event_id AND events.tenant_id = p_tenant_id
  RETURNING * INTO v_row;

  PERFORM write_audit_log(p_tenant_id, 'event', p_event_id, 'REASSIGN_EVENT_OWNER', p_actor_member_id,
    jsonb_build_object('owner_member_id', v_old_owner), jsonb_build_object('owner_member_id', p_new_owner_member_id));

  RETURN QUERY SELECT v_row.id, v_row.owner_member_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.bulk_reassign_event_owner_with_audit(
  p_outgoing_owner_id UUID, p_incoming_owner_id UUID, p_tenant_id UUID, p_actor_member_id UUID
)
RETURNS TABLE (reassigned_count INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE v_event_id UUID; v_count INT := 0;
BEGIN
  IF p_outgoing_owner_id = p_incoming_owner_id THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: outgoing and incoming owner must be different members';
  END IF;

  FOR v_event_id IN
    SELECT e.id FROM events e
    WHERE e.owner_member_id = p_outgoing_owner_id AND e.tenant_id = p_tenant_id
  LOOP
    PERFORM reassign_event_owner_with_audit(v_event_id, p_tenant_id, p_incoming_owner_id, p_actor_member_id);
    v_count := v_count + 1;
  END LOOP;

  RETURN QUERY SELECT v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.block_member_deactivation_if_owns_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE v_count INT;
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    SELECT COUNT(*) INTO v_count FROM events WHERE owner_member_id = NEW.id;
    IF v_count > 0 THEN
      RAISE EXCEPTION 'Cannot deactivate member %: still owns % event(s) — reassign ownership first', NEW.id, v_count;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_block_member_deactivation_if_owns_events ON members;
CREATE TRIGGER trigger_block_member_deactivation_if_owns_events
BEFORE UPDATE ON members
FOR EACH ROW EXECUTE FUNCTION block_member_deactivation_if_owns_events();
