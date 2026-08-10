-- DIP-FP-184-web: remove the location_url override field entirely.
--
-- Grounding (re-confirmed live before writing this): location_url appears only
-- inside insert_event_with_audit(), update_event_with_audit(),
-- create_event_series_with_audit(), and convert_event_to_series_with_audit() —
-- every trigger function body (validate_*_tenant_scope, enforce_*, etc.) was
-- grepped directly, not just declared parameters, and none reference it.
--
-- DROP FUNCTION IF EXISTS is required for insert_event_with_audit(),
-- update_event_with_audit(), and create_event_series_with_audit() — the first
-- two because RETURNS TABLE loses the location_url column, the third because
-- its parameter list itself changes (p_location_url removed), and Postgres
-- identifies a function by name + input parameter types, so CREATE OR REPLACE
-- with a shorter parameter list would create a second, orphaned overload
-- instead of truly replacing the old one.
--
-- convert_event_to_series_with_audit() is the one exception: it never took
-- p_location_url as a parameter (it copies v_event.location_url from the row
-- variable internally) and its RETURNS TABLE (series_id, event_ids) never
-- included it either — so per this project's own standing house rule (see
-- 20260719000050's header comment: "only required when the return shape
-- itself changes"), a plain CREATE OR REPLACE FUNCTION is correct there, no
-- DROP FUNCTION needed.
--
-- event_series.location_url is also dropped here even though the DIP's own
-- migration plan only named events.location_url — event_series has its own,
-- separate location_url TEXT column (from 20260709000032), written to only by
-- create_event_series_with_audit()/convert_event_to_series_with_audit(), both
-- being edited in this same migration to stop writing it. Leaving that column
-- in place would leave a permanently-dead, never-populated column behind,
-- contradicting the story's "removes the field entirely" intent. Confirmed no
-- other function, trigger, or view reads event_series.location_url before
-- dropping it.

DROP FUNCTION IF EXISTS public.insert_event_with_audit(
    UUID, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, JSONB, UUID,
    UUID, TEXT, TEXT, INTEGER, TEXT, BOOLEAN, UUID
);

CREATE OR REPLACE FUNCTION public.insert_event_with_audit(
    p_tenant_id UUID,
    p_event_type_id UUID,
    p_name TEXT,
    p_start_datetime TIMESTAMPTZ,
    p_end_datetime TIMESTAMPTZ,
    p_location_name TEXT,
    p_location_address TEXT,
    p_target JSONB,
    p_talk_id UUID,
    p_online_meeting_resource_id UUID,
    p_online_meeting_url TEXT,
    p_online_meeting_platform_label TEXT,
    p_rsvp_closure_days INTEGER,
    p_announcement_body TEXT,
    p_guests_allowed BOOLEAN,
    p_actor_member_id UUID
)
RETURNS TABLE (
    id UUID, name TEXT, status TEXT, start_datetime TIMESTAMPTZ,
    end_datetime TIMESTAMPTZ, location_name TEXT, location_address TEXT,
    target JSONB, talk_id UUID,
    online_meeting_resource_id UUID, online_meeting_url TEXT, online_meeting_platform_label TEXT,
    rsvp_closure_days INTEGER, announcement_body TEXT, guests_allowed BOOLEAN, created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_row events%ROWTYPE;
  v_is_announcement BOOLEAN;
  v_everyone_group_id UUID;
  v_end_datetime TIMESTAMPTZ := p_end_datetime;
  v_target JSONB := p_target;
  v_location_name TEXT := p_location_name;
  v_location_address TEXT := p_location_address;
BEGIN
  SELECT (et.system_key = 'ANNOUNCEMENT') INTO v_is_announcement
  FROM event_types et WHERE et.id = p_event_type_id AND et.tenant_id = p_tenant_id;

  IF v_is_announcement THEN
    SELECT g.id INTO v_everyone_group_id
    FROM groups g WHERE g.tenant_id = p_tenant_id AND g.system_key = 'EVERYONE' AND g.deleted_at IS NULL;

    IF v_everyone_group_id IS NULL THEN
      RAISE EXCEPTION 'ANNOUNCEMENT_MISSING_EVERYONE_GROUP: tenant % has no Everyone system group', p_tenant_id;
    END IF;

    v_end_datetime := p_start_datetime + INTERVAL '1 day';
    v_target := jsonb_build_object('group_ids', jsonb_build_array(v_everyone_group_id), 'member_ids', '[]'::jsonb);
    v_location_name := 'Announcement';
    v_location_address := 'N/A';
  END IF;

  INSERT INTO events (
    tenant_id, event_type_id, name, status, start_datetime, end_datetime,
    location_name, location_address, target, talk_id,
    online_meeting_resource_id, online_meeting_url, online_meeting_platform_label,
    rsvp_closure_days, announcement_body, guests_allowed
  ) VALUES (
    p_tenant_id, p_event_type_id, p_name, 'DRAFT', p_start_datetime, v_end_datetime,
    v_location_name, v_location_address, v_target, p_talk_id,
    p_online_meeting_resource_id, p_online_meeting_url, p_online_meeting_platform_label,
    p_rsvp_closure_days, p_announcement_body, COALESCE(p_guests_allowed, false)
  )
  RETURNING * INTO v_row;

  PERFORM write_audit_log(p_tenant_id, 'event', v_row.id, 'create', p_actor_member_id, NULL, to_jsonb(v_row));

  RETURN QUERY SELECT
    v_row.id, v_row.name, v_row.status, v_row.start_datetime,
    v_row.end_datetime, v_row.location_name, v_row.location_address,
    v_row.target, v_row.talk_id,
    v_row.online_meeting_resource_id, v_row.online_meeting_url, v_row.online_meeting_platform_label,
    v_row.rsvp_closure_days, v_row.announcement_body, v_row.guests_allowed, v_row.created_at;
END;
$$;


-- update_event_with_audit — patch-based, parameter signature unchanged
-- (UUID, UUID, JSONB, UUID); DROP FUNCTION IF EXISTS is still required here
-- because RETURNS TABLE loses the location_url column.

DROP FUNCTION IF EXISTS public.update_event_with_audit(UUID, UUID, JSONB, UUID);

CREATE OR REPLACE FUNCTION public.update_event_with_audit(
    p_event_id UUID,
    p_tenant_id UUID,
    p_patch JSONB,
    p_actor_member_id UUID
)
RETURNS TABLE (
    id UUID, name TEXT, status TEXT, version INT,
    start_datetime TIMESTAMPTZ, end_datetime TIMESTAMPTZ,
    location_name TEXT, location_address TEXT,
    target JSONB, talk_id UUID,
    online_meeting_resource_id UUID, online_meeting_url TEXT, online_meeting_platform_label TEXT,
    rsvp_closure_days INTEGER, event_type_id UUID, announcement_body TEXT, guests_allowed BOOLEAN, updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_before JSONB;
  v_row events%ROWTYPE;
  v_is_announcement BOOLEAN;
  v_everyone_group_id UUID;
BEGIN
  SELECT to_jsonb(e) INTO v_before FROM events e WHERE e.id = p_event_id AND e.tenant_id = p_tenant_id;

  UPDATE events SET
    name                     = COALESCE(p_patch->>'name',                    events.name),
    start_datetime           = COALESCE((p_patch->>'start_datetime')::TIMESTAMPTZ, events.start_datetime),
    end_datetime             = COALESCE((p_patch->>'end_datetime')::TIMESTAMPTZ,   events.end_datetime),
    location_name            = COALESCE(p_patch->>'location_name',          events.location_name),
    location_address         = COALESCE(p_patch->>'location_address',       events.location_address),
    target                   = COALESCE(p_patch->'target',                  events.target),
    talk_id                  = CASE WHEN p_patch ? 'talk_id' THEN (p_patch->>'talk_id')::UUID ELSE events.talk_id END,
    online_meeting_resource_id = CASE WHEN p_patch ? 'online_meeting_resource_id' THEN (p_patch->>'online_meeting_resource_id')::UUID ELSE events.online_meeting_resource_id END,
    online_meeting_url         = CASE WHEN p_patch ? 'online_meeting_url' THEN p_patch->>'online_meeting_url' ELSE events.online_meeting_url END,
    online_meeting_platform_label = CASE WHEN p_patch ? 'online_meeting_platform_label' THEN p_patch->>'online_meeting_platform_label' ELSE events.online_meeting_platform_label END,
    rsvp_closure_days        = CASE WHEN p_patch ? 'rsvp_closure_days' THEN (p_patch->>'rsvp_closure_days')::INTEGER ELSE events.rsvp_closure_days END,
    event_type_id            = CASE WHEN p_patch ? 'event_type_id' THEN (p_patch->>'event_type_id')::UUID ELSE events.event_type_id END,
    announcement_body        = CASE WHEN p_patch ? 'announcement_body' THEN p_patch->>'announcement_body' ELSE events.announcement_body END,
    guests_allowed           = CASE WHEN p_patch ? 'guests_allowed' THEN (p_patch->>'guests_allowed')::BOOLEAN ELSE events.guests_allowed END,
    version                  = events.version + 1,
    updated_at               = now()
  WHERE events.id = p_event_id AND events.tenant_id = p_tenant_id
  RETURNING * INTO v_row;

  SELECT (et.system_key = 'ANNOUNCEMENT') INTO v_is_announcement
  FROM event_types et WHERE et.id = v_row.event_type_id AND et.tenant_id = p_tenant_id;

  IF v_is_announcement THEN
    SELECT g.id INTO v_everyone_group_id
    FROM groups g WHERE g.tenant_id = p_tenant_id AND g.system_key = 'EVERYONE' AND g.deleted_at IS NULL;

    IF v_everyone_group_id IS NULL THEN
      RAISE EXCEPTION 'ANNOUNCEMENT_MISSING_EVERYONE_GROUP: tenant % has no Everyone system group', p_tenant_id;
    END IF;

    UPDATE events SET
      end_datetime      = events.start_datetime + INTERVAL '1 day',
      target             = jsonb_build_object('group_ids', jsonb_build_array(v_everyone_group_id), 'member_ids', '[]'::jsonb),
      location_name      = 'Announcement',
      location_address   = 'N/A'
    WHERE events.id = p_event_id AND events.tenant_id = p_tenant_id
    RETURNING * INTO v_row;

    -- Re-sync attendees to the forced Everyone target unconditionally — this
    -- must not depend on the client having sent a 'target' patch key, since
    -- the override above can change target even when it wasn't in p_patch.
    IF v_row.status = 'SCHEDULED' THEN
      INSERT INTO event_attendees (tenant_id, event_id, member_id)
      SELECT v_row.tenant_id, v_row.id, a.member_id
      FROM assignments a
      WHERE a.group_id = v_everyone_group_id AND a.assignment_type = 'GROUP'
        AND a.deleted_at IS NULL AND a.tenant_id = v_row.tenant_id
      ON CONFLICT DO NOTHING;

      DELETE FROM event_attendees ea
      WHERE ea.event_id = v_row.id AND ea.tenant_id = v_row.tenant_id
        AND ea.member_id NOT IN (
          SELECT a.member_id FROM assignments a
          WHERE a.group_id = v_everyone_group_id AND a.assignment_type = 'GROUP'
            AND a.deleted_at IS NULL AND a.tenant_id = v_row.tenant_id
        );
    END IF;
  ELSIF p_patch ? 'target' AND v_row.status = 'SCHEDULED' THEN
    -- FP-156: unchanged normal path for non-Announcement events.
    INSERT INTO event_attendees (tenant_id, event_id, member_id)
    SELECT v_row.tenant_id, v_row.id, a.member_id
    FROM assignments a
    WHERE a.group_id = ANY(ARRAY(SELECT jsonb_array_elements_text(v_row.target->'group_ids'))::UUID[])
      AND a.assignment_type = 'GROUP' AND a.deleted_at IS NULL AND a.tenant_id = v_row.tenant_id
    UNION
    SELECT v_row.tenant_id, v_row.id, m.id
    FROM members m
    WHERE m.id = ANY(ARRAY(SELECT jsonb_array_elements_text(v_row.target->'member_ids'))::UUID[])
      AND m.tenant_id = v_row.tenant_id AND m.deleted_at IS NULL
    ON CONFLICT DO NOTHING;

    DELETE FROM event_attendees ea
    WHERE ea.event_id = v_row.id AND ea.tenant_id = v_row.tenant_id
      AND ea.member_id NOT IN (
        SELECT a.member_id FROM assignments a
        WHERE a.group_id = ANY(ARRAY(SELECT jsonb_array_elements_text(v_row.target->'group_ids'))::UUID[])
          AND a.assignment_type = 'GROUP' AND a.deleted_at IS NULL AND a.tenant_id = v_row.tenant_id
        UNION
        SELECT m.id FROM members m
        WHERE m.id = ANY(ARRAY(SELECT jsonb_array_elements_text(v_row.target->'member_ids'))::UUID[])
          AND m.tenant_id = v_row.tenant_id AND m.deleted_at IS NULL
      );
  END IF;

  PERFORM write_audit_log(p_tenant_id, 'event', v_row.id, 'update', p_actor_member_id, v_before, to_jsonb(v_row));

  RETURN QUERY SELECT
    v_row.id, v_row.name, v_row.status, v_row.version, v_row.start_datetime,
    v_row.end_datetime, v_row.location_name, v_row.location_address,
    v_row.target, v_row.talk_id,
    v_row.online_meeting_resource_id, v_row.online_meeting_url, v_row.online_meeting_platform_label,
    v_row.rsvp_closure_days, v_row.event_type_id, v_row.announcement_body, v_row.guests_allowed, v_row.updated_at;
END;
$$;


-- create_event_series_with_audit — parameter list changes (p_location_url
-- removed), so DROP FUNCTION IF EXISTS with the old 11-param signature is
-- required to avoid leaving an orphaned overload behind.

DROP FUNCTION IF EXISTS public.create_event_series_with_audit(
    UUID, TEXT, JSONB, TEXT, UUID, TEXT, TEXT, TEXT, JSONB, UUID, UUID
);

CREATE OR REPLACE FUNCTION public.create_event_series_with_audit(
    p_tenant_id UUID,
    p_frequency TEXT,
    p_occurrence_dates JSONB, -- array of {start_datetime, end_datetime} pairs
    p_name TEXT,
    p_event_type_id UUID,
    p_location_name TEXT,
    p_location_address TEXT,
    p_target JSONB,
    p_talk_id UUID,
    p_actor_member_id UUID
)
RETURNS TABLE (series_id UUID, event_ids UUID[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_series_id UUID;
  v_event_ids UUID[] := '{}';
  v_occurrence JSONB;
  v_event_row events%ROWTYPE;
  v_count INT;
  v_cap INT;
BEGIN
  v_count := jsonb_array_length(p_occurrence_dates);
  IF v_count < 1 THEN
    RAISE EXCEPTION 'occurrence_count must be at least 1';
  END IF;

  v_cap := CASE p_frequency
    WHEN 'WEEKLY' THEN 52
    WHEN 'FORTNIGHTLY' THEN 26
    WHEN 'MONTHLY' THEN 12
    ELSE NULL
  END;
  IF v_cap IS NULL THEN
    RAISE EXCEPTION 'frequency must be WEEKLY, FORTNIGHTLY, or MONTHLY';
  END IF;
  IF v_count > v_cap THEN
    RAISE EXCEPTION 'occurrence_count % exceeds cap % for frequency %', v_count, v_cap, p_frequency;
  END IF;

  INSERT INTO event_series (
    tenant_id, frequency, occurrence_count, day_of_week, created_by,
    name, event_type_id, location_name, location_address, target, talk_id
  ) VALUES (
    p_tenant_id, p_frequency, v_count,
    EXTRACT(DOW FROM (p_occurrence_dates->0->>'start_datetime')::TIMESTAMPTZ)::INT,
    p_actor_member_id,
    p_name, p_event_type_id, p_location_name, p_location_address, p_target, p_talk_id
  )
  RETURNING id INTO v_series_id;

  FOR v_occurrence IN SELECT * FROM jsonb_array_elements(p_occurrence_dates)
  LOOP
    INSERT INTO events (
      tenant_id, event_type_id, name, status, start_datetime, end_datetime,
      location_name, location_address, target, talk_id, recurrence_series_id
    ) VALUES (
      p_tenant_id, p_event_type_id, p_name, 'DRAFT',
      (v_occurrence->>'start_datetime')::TIMESTAMPTZ, (v_occurrence->>'end_datetime')::TIMESTAMPTZ,
      p_location_name, p_location_address, p_target, p_talk_id, v_series_id
    )
    RETURNING * INTO v_event_row;

    PERFORM write_audit_log(p_tenant_id, 'event', v_event_row.id, 'create', p_actor_member_id, NULL, to_jsonb(v_event_row));
    v_event_ids := array_append(v_event_ids, v_event_row.id);
  END LOOP;

  RETURN QUERY SELECT v_series_id, v_event_ids;
END;
$$;


-- convert_event_to_series_with_audit — neither the parameter list nor
-- RETURNS TABLE (series_id, event_ids) reference location_url, so per the
-- house rule a plain CREATE OR REPLACE FUNCTION is correct; no DROP FUNCTION.

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
    name, event_type_id, location_name, location_address, target, talk_id
  ) VALUES (
    p_tenant_id, p_frequency, v_total_count, EXTRACT(DOW FROM v_event.start_datetime)::INT, p_actor_member_id,
    v_event.name, v_event.event_type_id, v_event.location_name, v_event.location_address,
    v_event.target, v_event.talk_id
  )
  RETURNING id INTO v_series_id;

  v_event_ids := ARRAY[p_event_id]; -- original event is occurrence 1 of the series

  FOR v_occurrence IN SELECT * FROM jsonb_array_elements(p_additional_occurrence_dates)
  LOOP
    INSERT INTO events (
      tenant_id, event_type_id, name, status, start_datetime, end_datetime,
      location_name, location_address, target, talk_id, recurrence_series_id
    ) VALUES (
      p_tenant_id, v_event.event_type_id, v_event.name, 'DRAFT',
      (v_occurrence->>'start_datetime')::TIMESTAMPTZ, (v_occurrence->>'end_datetime')::TIMESTAMPTZ,
      v_event.location_name, v_event.location_address, v_event.target, v_event.talk_id, v_series_id
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


ALTER TABLE events DROP COLUMN IF EXISTS location_url;
ALTER TABLE event_series DROP COLUMN IF EXISTS location_url;
