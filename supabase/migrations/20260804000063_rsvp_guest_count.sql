-- DIP-FP-189-web: guest headcount on RSVP. events.guests_allowed toggle
-- (default false, no effect on any existing event), rsvps.guest_count on
-- Yes/Tentative only (never No, enforced at the database layer), a
-- tenant-configurable max (default 10), and total_guests surfaced alongside
-- the existing per-status counts in the RSVP report.
--
-- Grounding correction made while writing this (confirmed against live
-- migration history, not assumed from the DIP text): the DIP's Grounding
-- Check claims insert_event_with_audit is "currently 15 params" — that was
-- true before FP-191 merged. FP-191 (20260803000062_announcement_system_type.sql,
-- already in dev) added p_announcement_body, making the real live signature
-- 16 params. The DROP FUNCTION below uses the real 16-param signature.
--
-- A CHECK constraint cannot reference another table's row (tenants.
-- max_guest_count_default) — this is a documented Postgres limitation, not
-- something that needed live experimentation to confirm. The tenant-max
-- enforcement is therefore a BEFORE INSERT OR UPDATE trigger on rsvps, per
-- the DIP's own fallback instruction.

-- ==============================================================
-- SECTION 1: tenants.max_guest_count_default — mirrors rsvp_closure_days_default's
-- exact idempotent ADD COLUMN + DO-block CHECK pattern (20260717000044).
-- ==============================================================

ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS max_guest_count_default INTEGER NOT NULL DEFAULT 10;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_max_guest_count_default_check'
  ) THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_max_guest_count_default_check
      CHECK (max_guest_count_default > 0);
  END IF;
END $$;


-- ==============================================================
-- SECTION 2: events.guests_allowed — default false, so every existing event
-- keeps today's behavior with zero data migration needed.
-- ==============================================================

ALTER TABLE events
    ADD COLUMN IF NOT EXISTS guests_allowed BOOLEAN NOT NULL DEFAULT false;


-- ==============================================================
-- SECTION 3: rsvps.guest_count — mirrors rsvps_reason_required_check's exact
-- shape (a status-conditional column constraint), just the inverse polarity:
-- reason is required for No, guest_count is forbidden for No.
-- ==============================================================

ALTER TABLE rsvps ADD COLUMN IF NOT EXISTS guest_count INTEGER;

ALTER TABLE rsvps DROP CONSTRAINT IF EXISTS rsvps_guest_count_status_check;
ALTER TABLE rsvps
    ADD CONSTRAINT rsvps_guest_count_status_check
    CHECK (guest_count IS NULL OR (rsvp_status IN ('YES', 'TENTATIVE') AND guest_count >= 0));


-- ==============================================================
-- SECTION 4: tenant-max enforcement — a plain CHECK constraint cannot look up
-- another table's row, so this is a trigger. RAISE EXCEPTION 'CODE: message'
-- convention, matching every other guard trigger in this codebase (mapped in
-- TS by error.code === 'P0001' + message-substring match).
-- ==============================================================

CREATE OR REPLACE FUNCTION public.enforce_rsvp_guest_count_max()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_max INTEGER;
BEGIN
  IF NEW.guest_count IS NOT NULL THEN
    SELECT max_guest_count_default INTO v_max FROM tenants WHERE id = NEW.tenant_id;
    IF v_max IS NOT NULL AND NEW.guest_count > v_max THEN
      RAISE EXCEPTION 'GUEST_COUNT_EXCEEDS_MAX: guest_count % exceeds this community''s max of %', NEW.guest_count, v_max;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_enforce_rsvp_guest_count_max ON rsvps;
CREATE TRIGGER trigger_enforce_rsvp_guest_count_max
BEFORE INSERT OR UPDATE ON rsvps
FOR EACH ROW EXECUTE FUNCTION enforce_rsvp_guest_count_max();


-- ==============================================================
-- SECTION 5: upsert_rsvp_with_audit — genuinely only ever defined once
-- (20260629000017_audit_logs.sql, confirmed by the DIP and re-confirmed
-- here), so the DROP FUNCTION signature below is simply that original
-- 6-arg signature, no "find the last redefinition" search needed. Adds
-- p_guest_count INTEGER before p_actor_member_id, same placement
-- convention as every prior extension of insert_event_with_audit.
-- ==============================================================

DROP FUNCTION IF EXISTS public.upsert_rsvp_with_audit(UUID, UUID, UUID, TEXT, TEXT, UUID);

CREATE OR REPLACE FUNCTION public.upsert_rsvp_with_audit(
    p_tenant_id UUID,
    p_event_id UUID,
    p_member_id UUID,
    p_rsvp_status TEXT,
    p_rsvp_reason TEXT,
    p_guest_count INTEGER,
    p_actor_member_id UUID
)
RETURNS SETOF rsvps
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_before JSONB;
  v_action TEXT;
  v_row rsvps%ROWTYPE;
  v_now TIMESTAMPTZ := now();
BEGIN
  SELECT to_jsonb(r) INTO v_before FROM rsvps r
  WHERE r.tenant_id = p_tenant_id AND r.event_id = p_event_id AND r.member_id = p_member_id;

  v_action := CASE WHEN v_before IS NULL THEN 'create' ELSE 'update' END;

  INSERT INTO rsvps (tenant_id, event_id, member_id, rsvp_status, rsvp_reason, guest_count, responded_at, updated_at)
  VALUES (p_tenant_id, p_event_id, p_member_id, p_rsvp_status, p_rsvp_reason, p_guest_count, v_now, v_now)
  ON CONFLICT (tenant_id, event_id, member_id) DO UPDATE SET
    rsvp_status = EXCLUDED.rsvp_status,
    rsvp_reason = EXCLUDED.rsvp_reason,
    guest_count = EXCLUDED.guest_count,
    responded_at = EXCLUDED.responded_at,
    updated_at = EXCLUDED.updated_at
  RETURNING * INTO v_row;

  PERFORM write_audit_log(p_tenant_id, 'rsvp', v_row.id, v_action, p_actor_member_id, v_before, to_jsonb(v_row));

  RETURN NEXT v_row;
END;
$$;


-- ==============================================================
-- SECTION 6: insert_event_with_audit — real live signature is 16 params
-- (see Grounding correction above), adding p_guests_allowed BOOLEAN before
-- p_actor_member_id (17 params total). Every other line of this function's
-- body — the Announcement-forcing logic from FP-191 — is carried forward
-- completely unchanged.
-- ==============================================================

DROP FUNCTION IF EXISTS public.insert_event_with_audit(UUID, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, JSONB, UUID, UUID, TEXT, TEXT, INTEGER, TEXT, UUID);

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
    end_datetime TIMESTAMPTZ, location_name TEXT, location_address TEXT, location_url TEXT,
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
    location_name, location_address, location_url, target, talk_id,
    online_meeting_resource_id, online_meeting_url, online_meeting_platform_label,
    rsvp_closure_days, announcement_body, guests_allowed
  ) VALUES (
    p_tenant_id, p_event_type_id, p_name, 'DRAFT', p_start_datetime, v_end_datetime,
    v_location_name, v_location_address, p_location_url, v_target, p_talk_id,
    p_online_meeting_resource_id, p_online_meeting_url, p_online_meeting_platform_label,
    p_rsvp_closure_days, p_announcement_body, COALESCE(p_guests_allowed, false)
  )
  RETURNING * INTO v_row;

  PERFORM write_audit_log(p_tenant_id, 'event', v_row.id, 'create', p_actor_member_id, NULL, to_jsonb(v_row));

  RETURN QUERY SELECT
    v_row.id, v_row.name, v_row.status, v_row.start_datetime,
    v_row.end_datetime, v_row.location_name, v_row.location_address, v_row.location_url,
    v_row.target, v_row.talk_id,
    v_row.online_meeting_resource_id, v_row.online_meeting_url, v_row.online_meeting_platform_label,
    v_row.rsvp_closure_days, v_row.announcement_body, v_row.guests_allowed, v_row.created_at;
END;
$$;


-- ==============================================================
-- SECTION 7: update_event_with_audit — patch-based, signature unchanged
-- (UUID, UUID, JSONB, UUID). Adds guests_allowed as a standard
-- CASE WHEN p_patch ? 'guests_allowed' branch, same shape as every other
-- patchable column. Every other line — including FP-191's Announcement-
-- forcing logic and the event_attendees resync blocks — is carried forward
-- completely unchanged.
-- ==============================================================

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
    location_name TEXT, location_address TEXT, location_url TEXT,
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
    location_url             = CASE WHEN p_patch ? 'location_url' THEN p_patch->>'location_url' ELSE events.location_url END,
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
    v_row.end_datetime, v_row.location_name, v_row.location_address, v_row.location_url,
    v_row.target, v_row.talk_id,
    v_row.online_meeting_resource_id, v_row.online_meeting_url, v_row.online_meeting_platform_label,
    v_row.rsvp_closure_days, v_row.event_type_id, v_row.announcement_body, v_row.guests_allowed, v_row.updated_at;
END;
$$;
