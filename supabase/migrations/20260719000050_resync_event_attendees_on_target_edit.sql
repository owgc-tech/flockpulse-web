-- DIP-FP-156: re-sync event_attendees when an already-scheduled event's target is edited.
--
-- Carries forward update_event_with_audit()'s full current definition from migration
-- 20260718000048 unchanged (confirmed live before writing this) — only the new resync
-- block is added, immediately after `RETURNING * INTO v_row` and before the
-- write_audit_log() call, same transaction as the target column write itself.
--
-- RETURNS TABLE signature is unchanged (no new output columns), so a plain
-- CREATE OR REPLACE FUNCTION is correct — no DROP FUNCTION IF EXISTS needed here,
-- per the standing house rule (only required when the return shape itself changes).
--
-- Guard: the resync only runs when v_row.status = 'SCHEDULED' after the UPDATE.
-- DRAFT events are guaranteed to have zero event_attendees rows by design (the
-- materialization trigger, handle_event_scheduling(), only fires on the DRAFT->SCHEDULED
-- transition — see listEventsForMember()'s comment in src/features/events/service.ts).
-- Running this resync unconditionally on every target patch would wrongly create
-- event_attendees rows for a still-unpublished DRAFT event, prematurely surfacing it in
-- members' My Events lists.
--
-- rsvps/attendance are keyed independently on (event_id, member_id) against events/members
-- directly (confirmed live: neither table has any FK to event_attendees) — deleting an
-- event_attendees row here has zero cascading effect on either, matching the "historical
-- fact, independent of the current invite list" design intent.

CREATE OR REPLACE FUNCTION public.update_event_with_audit(
    p_event_id UUID,
    p_tenant_id UUID,
    p_patch JSONB,
    p_actor_member_id UUID
)
RETURNS TABLE (
    id UUID, name TEXT, status TEXT, version INT,
    start_datetime TIMESTAMPTZ, end_datetime TIMESTAMPTZ,
    location_name TEXT, location_address TEXT, location_url TEXT,
    target JSONB, talk_id UUID, prayer_leader_member_id UUID, food_assignment JSONB,
    online_meeting_resource_id UUID, online_meeting_url TEXT, online_meeting_platform_label TEXT,
    rsvp_closure_days INTEGER, event_type_id UUID, updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_before JSONB;
  v_row events%ROWTYPE;
BEGIN
  SELECT to_jsonb(e) INTO v_before FROM events e WHERE e.id = p_event_id AND e.tenant_id = p_tenant_id;

  UPDATE events SET
    name                     = COALESCE(p_patch->>'name',                    events.name),
    start_datetime           = COALESCE((p_patch->>'start_datetime')::TIMESTAMPTZ, events.start_datetime),
    end_datetime             = COALESCE((p_patch->>'end_datetime')::TIMESTAMPTZ,   events.end_datetime),
    location_name            = COALESCE(p_patch->>'location_name',          events.location_name),
    location_address         = COALESCE(p_patch->>'location_address',       events.location_address),
    location_url             = CASE WHEN p_patch ? 'location_url' THEN p_patch->>'location_url' ELSE events.location_url END,
    target                   = COALESCE(p_patch->'target',                  events.target),
    talk_id                  = CASE WHEN p_patch ? 'talk_id' THEN (p_patch->>'talk_id')::UUID ELSE events.talk_id END,
    prayer_leader_member_id  = CASE WHEN p_patch ? 'prayer_leader_member_id' THEN (p_patch->>'prayer_leader_member_id')::UUID ELSE events.prayer_leader_member_id END,
    food_assignment          = CASE WHEN p_patch ? 'food_assignment' THEN p_patch->'food_assignment' ELSE events.food_assignment END,
    online_meeting_resource_id = CASE WHEN p_patch ? 'online_meeting_resource_id' THEN (p_patch->>'online_meeting_resource_id')::UUID ELSE events.online_meeting_resource_id END,
    online_meeting_url         = CASE WHEN p_patch ? 'online_meeting_url' THEN p_patch->>'online_meeting_url' ELSE events.online_meeting_url END,
    online_meeting_platform_label = CASE WHEN p_patch ? 'online_meeting_platform_label' THEN p_patch->>'online_meeting_platform_label' ELSE events.online_meeting_platform_label END,
    rsvp_closure_days        = CASE WHEN p_patch ? 'rsvp_closure_days' THEN (p_patch->>'rsvp_closure_days')::INTEGER ELSE events.rsvp_closure_days END,
    event_type_id            = CASE WHEN p_patch ? 'event_type_id' THEN (p_patch->>'event_type_id')::UUID ELSE events.event_type_id END,
    version                  = events.version + 1,
    updated_at               = now()
  WHERE events.id = p_event_id AND events.tenant_id = p_tenant_id
  RETURNING * INTO v_row;

  -- FP-156: re-sync event_attendees atomically with the target column write, reusing
  -- handle_event_scheduling()'s exact roster-resolution logic (group_ids union member_ids,
  -- both tenant-scoped) for both the add and remove halves. SCHEDULED-status guard is not
  -- optional — see the header note above.
  IF p_patch ? 'target' AND v_row.status = 'SCHEDULED' THEN
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
    v_row.end_datetime, v_row.location_name, v_row.location_address, v_row.location_url,
    v_row.target, v_row.talk_id, v_row.prayer_leader_member_id, v_row.food_assignment,
    v_row.online_meeting_resource_id, v_row.online_meeting_url, v_row.online_meeting_platform_label,
    v_row.rsvp_closure_days, v_row.event_type_id, v_row.updated_at;
END;
$$;
