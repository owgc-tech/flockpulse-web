-- FP-125 / FP-133: RSVP closure window (tenant default + per-event override).
-- Community name editability needs no schema change (tenants.name exists).

ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS rsvp_closure_days_default INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_rsvp_closure_days_default_check'
  ) THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_rsvp_closure_days_default_check
      CHECK (rsvp_closure_days_default >= 0 AND rsvp_closure_days_default <= 90);
  END IF;
END $$;

ALTER TABLE events
    ADD COLUMN IF NOT EXISTS rsvp_closure_days INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_rsvp_closure_days_check'
  ) THEN
    ALTER TABLE events
      ADD CONSTRAINT events_rsvp_closure_days_check
      CHECK (rsvp_closure_days IS NULL OR (rsvp_closure_days >= 0 AND rsvp_closure_days <= 90));
  END IF;
END $$;

-- ==============================================================
-- Extend insert_event_with_audit / update_event_with_audit to carry
-- rsvp_closure_days. Not called out in the DIP's migration body, but both
-- RPCs are explicit-signature/explicit-patch-key SECURITY DEFINER functions
-- (not generic passthroughs) — the DROP + CREATE OR REPLACE with the exact
-- current signature is required before CREATE OR REPLACE (Postgres rejects
-- an output-column-set change otherwise), same pattern as every prior
-- extension of these two functions (000017, 000034, 000040).
-- ==============================================================

DROP FUNCTION IF EXISTS public.insert_event_with_audit(UUID, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, JSONB, UUID, UUID, JSONB, UUID, TEXT, TEXT, UUID);
DROP FUNCTION IF EXISTS public.update_event_with_audit(UUID, UUID, JSONB, UUID);

CREATE OR REPLACE FUNCTION public.insert_event_with_audit(
    p_tenant_id UUID,
    p_event_type_id UUID,
    p_name TEXT,
    p_start_datetime TIMESTAMPTZ,
    p_end_datetime TIMESTAMPTZ,
    p_location_name TEXT,
    p_location_address TEXT,
    p_location_url TEXT,
    p_target JSONB,
    p_talk_id UUID,
    p_prayer_leader_member_id UUID,
    p_food_assignment JSONB,
    p_online_meeting_resource_id UUID,
    p_online_meeting_url TEXT,
    p_online_meeting_platform_label TEXT,
    p_rsvp_closure_days INTEGER,
    p_actor_member_id UUID
)
RETURNS TABLE (
    id UUID, name TEXT, status TEXT, start_datetime TIMESTAMPTZ,
    end_datetime TIMESTAMPTZ, location_name TEXT, location_address TEXT, location_url TEXT,
    target JSONB, talk_id UUID, prayer_leader_member_id UUID, food_assignment JSONB,
    online_meeting_resource_id UUID, online_meeting_url TEXT, online_meeting_platform_label TEXT,
    rsvp_closure_days INTEGER, created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_row events%ROWTYPE;
BEGIN
  INSERT INTO events (
    tenant_id, event_type_id, name, status, start_datetime, end_datetime,
    location_name, location_address, location_url, target, talk_id,
    prayer_leader_member_id, food_assignment,
    online_meeting_resource_id, online_meeting_url, online_meeting_platform_label,
    rsvp_closure_days
  ) VALUES (
    p_tenant_id, p_event_type_id, p_name, 'DRAFT', p_start_datetime, p_end_datetime,
    p_location_name, p_location_address, p_location_url, p_target, p_talk_id,
    p_prayer_leader_member_id, p_food_assignment,
    p_online_meeting_resource_id, p_online_meeting_url, p_online_meeting_platform_label,
    p_rsvp_closure_days
  )
  RETURNING * INTO v_row;

  PERFORM write_audit_log(p_tenant_id, 'event', v_row.id, 'create', p_actor_member_id, NULL, to_jsonb(v_row));

  RETURN QUERY SELECT
    v_row.id, v_row.name, v_row.status, v_row.start_datetime,
    v_row.end_datetime, v_row.location_name, v_row.location_address, v_row.location_url,
    v_row.target, v_row.talk_id, v_row.prayer_leader_member_id, v_row.food_assignment,
    v_row.online_meeting_resource_id, v_row.online_meeting_url, v_row.online_meeting_platform_label,
    v_row.rsvp_closure_days, v_row.created_at;
END;
$$;


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
    rsvp_closure_days INTEGER, updated_at TIMESTAMPTZ
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
    version                  = events.version + 1,
    updated_at               = now()
  WHERE events.id = p_event_id AND events.tenant_id = p_tenant_id
  RETURNING * INTO v_row;

  PERFORM write_audit_log(p_tenant_id, 'event', v_row.id, 'update', p_actor_member_id, v_before, to_jsonb(v_row));

  RETURN QUERY SELECT
    v_row.id, v_row.name, v_row.status, v_row.version, v_row.start_datetime,
    v_row.end_datetime, v_row.location_name, v_row.location_address, v_row.location_url,
    v_row.target, v_row.talk_id, v_row.prayer_leader_member_id, v_row.food_assignment,
    v_row.online_meeting_resource_id, v_row.online_meeting_url, v_row.online_meeting_platform_label,
    v_row.rsvp_closure_days, v_row.updated_at;
END;
$$;
