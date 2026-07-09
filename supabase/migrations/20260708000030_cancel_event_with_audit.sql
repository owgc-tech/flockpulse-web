-- DIP-FP-60-61-64-65-67, Phase 6: cancel_event_with_audit()
--
-- Matches the atomic pattern of insert_event_with_audit()/update_event_with_audit(): fetch
-- current state, raise if already CANCELLED or LOCKED, set status = 'CANCELLED', write the
-- audit entry — all in one function call. trigger_suppress_notifications_on_cancel (confirmed
-- live, still wired AFTER UPDATE ON events) fires automatically off the plain UPDATE below and
-- cancels PENDING/RETRYING event_notifications — not duplicated here.
--
-- Two deviations from the DIP's illustrative SQL, both confirmed by testing against the real
-- function rather than trusting the snippet:
--
-- 1. events_status_check only permits ('DRAFT', 'SCHEDULED', 'CANCELLED') as *stored* values —
--    LOCKED is never stored, it only exists as a derived return value of
--    get_event_effective_status() (FP-47's time-derived ACTIVE/COMPLETED/LOCKED states).
--    Checking the raw stored status column for 'LOCKED' would be dead code that never fires,
--    silently allowing a locked (attendance-window-passed) event to be cancelled. This uses
--    get_event_effective_status() instead so the LOCKED check actually works.
--
-- 2. RETURNS TABLE (id UUID, ...) columns become PL/pgSQL OUT-parameter variables named
--    id/status/updated_at, visible as bare identifiers inside the function body. The DIP's
--    illustrative "WHERE id = p_event_id AND tenant_id = p_tenant_id" is ambiguous against
--    those OUT parameters — same class of bug update_event_with_audit() already documents
--    guarding against ("qualified with events. to avoid ambiguity with PL/pgSQL output column
--    variables"). Caught by actually running this function, not by inspection: it failed with
--    "column reference \"id\" is ambiguous" (SQLSTATE 42702). Fixed by qualifying both sides
--    of the WHERE clause with the events. table alias.

CREATE OR REPLACE FUNCTION public.cancel_event_with_audit(
    p_event_id UUID,
    p_tenant_id UUID,
    p_actor_member_id UUID
)
RETURNS TABLE (id UUID, status TEXT, updated_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_before JSONB;
  v_effective_status TEXT;
  v_row events%ROWTYPE;
BEGIN
  SELECT to_jsonb(e) INTO v_before FROM events e WHERE e.id = p_event_id AND e.tenant_id = p_tenant_id;
  IF v_before IS NULL THEN
    RAISE EXCEPTION 'event % not found for tenant %', p_event_id, p_tenant_id;
  END IF;

  v_effective_status := public.get_event_effective_status(p_event_id);
  IF v_effective_status IN ('CANCELLED', 'LOCKED') THEN
    RAISE EXCEPTION 'event % cannot be cancelled from status %', p_event_id, v_effective_status;
  END IF;

  UPDATE events SET status = 'CANCELLED', updated_at = now()
  WHERE events.id = p_event_id AND events.tenant_id = p_tenant_id
  RETURNING * INTO v_row;

  PERFORM write_audit_log(p_tenant_id, 'event', v_row.id, 'cancel', p_actor_member_id, v_before, to_jsonb(v_row));

  RETURN QUERY SELECT v_row.id, v_row.status, v_row.updated_at;
END;
$$;
