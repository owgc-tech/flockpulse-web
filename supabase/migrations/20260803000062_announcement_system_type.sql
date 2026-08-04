-- DIP-FP-191-web: system-managed "Announcement" event type, one per tenant —
-- mirrors FP-181's Everyone system group pattern (system_key marker, partial
-- unique index, AFTER INSERT ON tenants auto-provisioning, BEFORE UPDATE
-- rename/delete guard). Adds events.announcement_body, a genuinely separate
-- announcement_acknowledgements table (never member_attendance_reports/
-- attendance), and extends insert_event_with_audit/update_event_with_audit
-- to server-side-enforce end_datetime = start_datetime + 1 day and
-- target = the tenant's Everyone group whenever p_event_type_id resolves to
-- Announcement, regardless of what the client sends.
--
-- Grounding corrections made while writing this (confirmed against live code/DB,
-- not assumed from the DIP text):
--   - insert_event_with_audit's live signature is 15 params (not 17 as the DIP's
--     Grounding Check claimed), confirmed by reading the current CREATE OR REPLACE
--     in 20260720000054_drop_prayer_leader_food_assignment_columns.sql directly.
--     DROP FUNCTION below uses the real 15-param signature.
--   - update_event_with_audit has never shared insert's positional-arg shape —
--     it's patch-based, (UUID, UUID, JSONB, UUID), unchanged since introduction.
--     "p_announcement_body appended before p_actor_member_id" (the DIP's literal
--     instruction) does not apply to it; announcement_body is instead handled as
--     a CASE WHEN p_patch ? 'announcement_body' branch, same as every other
--     nullable patchable column in that function.
--   - The DIP's literal target override, jsonb_build_object('group_id', ...)
--     (singular), does NOT match the real target shape. handle_event_scheduling()
--     and update_event_with_audit's own target-resync block both read
--     target->'group_ids' (plural, JSONB array) via jsonb_array_elements_text —
--     confirmed by reading 20260708000028_multi_target_event_scheduling.sql and
--     20260720000054's resync block directly. Using the DIP's literal singular key
--     would silently target nobody (jsonb_array_elements_text over a NULL/missing
--     key yields zero rows), defeating the feature. Corrected to
--     jsonb_build_object('group_ids', jsonb_build_array(<id>), 'member_ids', '[]').
--   - events.location_name and events.location_address are both TEXT NOT NULL
--     (confirmed: 20260629000002 for location_name, 20260708000029 for
--     location_address SET NOT NULL) — not addressed anywhere in the DIP's
--     Grounding Check. Both RPCs force fixed placeholder values for Announcement
--     rows ('Announcement' / 'N/A') server-side, same "override regardless of
--     client input" treatment as end_datetime/target, so the NOT NULL constraints
--     are always satisfiable without the web form ever needing to fake real values.
--   - If a tenant somehow has no EVERYONE group (FP-181's own provisioning is a
--     precondition, confirmed applied to fpdb-dev before writing this), both RPCs
--     raise ANNOUNCEMENT_MISSING_EVERYONE_GROUP rather than silently creating an
--     un-targeted announcement — no DIP mention either way; erring toward a loud
--     failure over a silently broken row.

-- ==============================================================
-- SECTION 1: schema — system_key marker + one-per-tenant guarantee on
-- event_types (mirrors groups.system_key from FP-181 exactly).
-- ==============================================================

ALTER TABLE event_types ADD COLUMN IF NOT EXISTS system_key TEXT;

ALTER TABLE event_types DROP CONSTRAINT IF EXISTS event_types_system_key_check;
ALTER TABLE event_types
    ADD CONSTRAINT event_types_system_key_check
    CHECK (system_key IS NULL OR system_key = 'ANNOUNCEMENT');

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_types_unique_system_key_per_tenant
    ON event_types(tenant_id, system_key)
    WHERE system_key IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE events ADD COLUMN IF NOT EXISTS announcement_body TEXT;


-- ==============================================================
-- SECTION 2: announcement_acknowledgements — deliberately its own table with
-- zero FK/code path to member_attendance_reports/attendance. Talk completion
-- is keyed strictly off attendance_status = ATTENDED elsewhere in this
-- codebase; acknowledgement must be structurally unable to reach that.
-- ==============================================================

CREATE TABLE IF NOT EXISTS announcement_acknowledgements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE announcement_acknowledgements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenants can access their own announcement acknowledgements"
    ON announcement_acknowledgements USING (tenant_id = get_tenant_id());

CREATE UNIQUE INDEX IF NOT EXISTS idx_announcement_acknowledgements_unique_event_member
    ON announcement_acknowledgements(event_id, member_id);


-- ==============================================================
-- SECTION 3: backfill — one Announcement event_types row per existing tenant.
-- Idempotent via WHERE NOT EXISTS.
-- ==============================================================

INSERT INTO event_types (tenant_id, name, code, system_key)
SELECT t.id, 'Announcement', 'ANNOUNCEMENT', 'ANNOUNCEMENT'
FROM tenants t
WHERE NOT EXISTS (
    SELECT 1 FROM event_types et WHERE et.tenant_id = t.id AND et.system_key = 'ANNOUNCEMENT'
);


-- ==============================================================
-- SECTION 4: new tenants get an Announcement type automatically. Coexists
-- with FP-181's trigger_create_everyone_group_for_new_tenant on the same
-- AFTER INSERT ON tenants event — Postgres fires every trigger registered
-- for that event, so no conflict.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.create_announcement_event_type_for_new_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  INSERT INTO event_types (tenant_id, name, code, system_key)
  VALUES (NEW.id, 'Announcement', 'ANNOUNCEMENT', 'ANNOUNCEMENT');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_create_announcement_event_type_for_new_tenant ON tenants;
CREATE TRIGGER trigger_create_announcement_event_type_for_new_tenant
AFTER INSERT ON tenants
FOR EACH ROW EXECUTE FUNCTION create_announcement_event_type_for_new_tenant();


-- ==============================================================
-- SECTION 5: block rename/delete of a system-managed event_types row, any
-- role, any path. Reuses the SYSTEM_MANAGED_GROUP error code (per the DIP's
-- explicit instruction, "for consistency... same protection class" even
-- though this is event_types not groups) so existing P0001 + message-
-- substring mapping conventions catch it without a new code to learn.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.block_system_event_type_rename_or_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF OLD.system_key IS NOT NULL THEN
    IF NEW.name IS DISTINCT FROM OLD.name THEN
      RAISE EXCEPTION 'SYSTEM_MANAGED_GROUP: cannot rename or delete a system-managed event type';
    END IF;
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
      RAISE EXCEPTION 'SYSTEM_MANAGED_GROUP: cannot rename or delete a system-managed event type';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_block_system_event_type_rename_or_delete ON event_types;
CREATE TRIGGER trigger_block_system_event_type_rename_or_delete
BEFORE UPDATE ON event_types
FOR EACH ROW EXECUTE FUNCTION block_system_event_type_rename_or_delete();


-- ==============================================================
-- SECTION 6: insert_event_with_audit — add p_announcement_body TEXT before
-- p_actor_member_id (real 15-param live signature + 1, per the Grounding
-- correction above). Forces end_datetime/target/location_name/
-- location_address server-side whenever p_event_type_id resolves to the
-- tenant's Announcement system type.
-- ==============================================================

DROP FUNCTION IF EXISTS public.insert_event_with_audit(UUID, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, JSONB, UUID, UUID, TEXT, TEXT, INTEGER, UUID);

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
    p_actor_member_id UUID
)
RETURNS TABLE (
    id UUID, name TEXT, status TEXT, start_datetime TIMESTAMPTZ,
    end_datetime TIMESTAMPTZ, location_name TEXT, location_address TEXT, location_url TEXT,
    target JSONB, talk_id UUID,
    online_meeting_resource_id UUID, online_meeting_url TEXT, online_meeting_platform_label TEXT,
    rsvp_closure_days INTEGER, announcement_body TEXT, created_at TIMESTAMPTZ
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
    rsvp_closure_days, announcement_body
  ) VALUES (
    p_tenant_id, p_event_type_id, p_name, 'DRAFT', p_start_datetime, v_end_datetime,
    v_location_name, v_location_address, p_location_url, v_target, p_talk_id,
    p_online_meeting_resource_id, p_online_meeting_url, p_online_meeting_platform_label,
    p_rsvp_closure_days, p_announcement_body
  )
  RETURNING * INTO v_row;

  PERFORM write_audit_log(p_tenant_id, 'event', v_row.id, 'create', p_actor_member_id, NULL, to_jsonb(v_row));

  RETURN QUERY SELECT
    v_row.id, v_row.name, v_row.status, v_row.start_datetime,
    v_row.end_datetime, v_row.location_name, v_row.location_address, v_row.location_url,
    v_row.target, v_row.talk_id,
    v_row.online_meeting_resource_id, v_row.online_meeting_url, v_row.online_meeting_platform_label,
    v_row.rsvp_closure_days, v_row.announcement_body, v_row.created_at;
END;
$$;


-- ==============================================================
-- SECTION 7: update_event_with_audit — patch-based, signature unchanged
-- (UUID, UUID, JSONB, UUID; see Grounding correction above). Adds
-- announcement_body as a standard CASE WHEN p_patch ? 'announcement_body'
-- branch, then re-derives whether the row (after the patch) is an
-- Announcement and, if so, force-overrides end_datetime/target/
-- location_name/location_address the same way insert does — an edit that
-- changes start_datetime, or (re)selects the Announcement type, must not be
-- able to leave a stale end_datetime or a non-Everyone target in place.
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
    rsvp_closure_days INTEGER, event_type_id UUID, announcement_body TEXT, updated_at TIMESTAMPTZ
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
    v_row.rsvp_closure_days, v_row.event_type_id, v_row.announcement_body, v_row.updated_at;
END;
$$;
