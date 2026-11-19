-- DIP-FP-106: convert an existing single event into the first occurrence of a new series
--
-- Confirmed live before writing this (all correct as of DIP-FP-63-FP-68's grounding, re-verified):
--   - events/event_series column sets unchanged.
--   - trigger_validate_event_series_tenant_scope fires BEFORE INSERT OR UPDATE — so the plain
--     UPDATE at the end of this function (setting recurrence_series_id on the original event)
--     gets the cross-tenant check for free. No new trigger needed for this story.
--   - get_event_effective_status()'s return set unchanged (DRAFT/SCHEDULED/ACTIVE/COMPLETED/LOCKED/CANCELLED).
--   - write_audit_log()'s signature unchanged.
--
-- Same atomicity reasoning as create_event_series_with_audit(): one event_series row + N-1
-- events rows + one UPDATE on the original event, all in a single transaction — a partial
-- failure must not leave the original event half-attached to a series that doesn't fully exist.

CREATE OR REPLACE FUNCTION public.convert_event_to_series_with_audit(
    p_event_id UUID,
    p_tenant_id UUID,
    p_frequency TEXT,
    p_additional_occurrence_dates JSONB, -- array of {start_datetime, end_datetime} for the NEW siblings only (existing event's own dates are untouched)
    p_actor_member_id UUID
)
RETURNS TABLE (series_id UUID, event_ids UUID[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_event events%ROWTYPE;
  v_effective_status TEXT;
  v_series_id UUID;
  v_event_ids UUID[];
  v_occurrence JSONB;
  v_new_row events%ROWTYPE;
  v_before JSONB;
  v_total_count INT;
  v_cap INT;
BEGIN
  SELECT * INTO v_event FROM events WHERE id = p_event_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event % not found for tenant %', p_event_id, p_tenant_id;
  END IF;

  IF v_event.recurrence_series_id IS NOT NULL THEN
    RAISE EXCEPTION 'event % already belongs to a series', p_event_id;
  END IF;

  v_effective_status := public.get_event_effective_status(p_event_id);
  IF v_effective_status IN ('CANCELLED', 'COMPLETED', 'LOCKED') THEN
    RAISE EXCEPTION 'event % cannot be converted to a series from status %', p_event_id, v_effective_status;
  END IF;

  v_total_count := 1 + jsonb_array_length(p_additional_occurrence_dates);
  v_cap := CASE p_frequency WHEN 'WEEKLY' THEN 52 WHEN 'FORTNIGHTLY' THEN 26 WHEN 'MONTHLY' THEN 12 ELSE NULL END;
  IF v_cap IS NULL THEN
    RAISE EXCEPTION 'frequency must be WEEKLY, FORTNIGHTLY, or MONTHLY';
  END IF;
  IF v_total_count > v_cap THEN
    RAISE EXCEPTION 'total occurrence_count % exceeds cap % for frequency %', v_total_count, v_cap, p_frequency;
  END IF;

  -- Template fields come from the existing event, unchanged.
  INSERT INTO event_series (
    tenant_id, frequency, occurrence_count, day_of_week, created_by,
    name, event_type_id, location_name, location_address, location_url, target, talk_id
  ) VALUES (
    p_tenant_id, p_frequency, v_total_count, EXTRACT(DOW FROM v_event.start_datetime)::INT, p_actor_member_id,
    v_event.name, v_event.event_type_id, v_event.location_name, v_event.location_address,
    v_event.location_url, v_event.target, v_event.talk_id
  )
  RETURNING id INTO v_series_id;

  v_event_ids := ARRAY[p_event_id]; -- original event is occurrence 1 of the series

  FOR v_occurrence IN SELECT * FROM jsonb_array_elements(p_additional_occurrence_dates)
  LOOP
    INSERT INTO events (
      tenant_id, event_type_id, name, status, start_datetime, end_datetime,
      location_name, location_address, location_url, target, talk_id, recurrence_series_id
    ) VALUES (
      p_tenant_id, v_event.event_type_id, v_event.name, 'DRAFT',
      (v_occurrence->>'start_datetime')::TIMESTAMPTZ, (v_occurrence->>'end_datetime')::TIMESTAMPTZ,
      v_event.location_name, v_event.location_address, v_event.location_url, v_event.target, v_event.talk_id, v_series_id
    )
    RETURNING * INTO v_new_row;

    PERFORM write_audit_log(p_tenant_id, 'event', v_new_row.id, 'create', p_actor_member_id, NULL, to_jsonb(v_new_row));
    v_event_ids := array_append(v_event_ids, v_new_row.id);
  END LOOP;

  -- Attach the original event to the new series — only recurrence_series_id changes.
  v_before := to_jsonb(v_event);
  UPDATE events SET recurrence_series_id = v_series_id, updated_at = now()
  WHERE events.id = p_event_id AND events.tenant_id = p_tenant_id;

  PERFORM write_audit_log(
    p_tenant_id, 'event', p_event_id, 'update', p_actor_member_id,
    v_before, (SELECT to_jsonb(e) FROM events e WHERE e.id = p_event_id)
  );

  RETURN QUERY SELECT v_series_id, v_event_ids;
END;
$$;
