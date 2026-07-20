-- DIP-FP-161-4: Phase 4 of 5 for FP-161 — drops events.prayer_leader_member_id and
-- events.food_assignment. Phase 3 (FP-161-3) stopped the app reading/writing either
-- column; Phase 3's own two follow-ups (FP-162, FP-163) have been live and stable
-- since. No backfill was ever wanted for these (Phase 3's own explicit direction) —
-- pure cleanup, no data at stake.
--
-- Order matters: both RPCs below still reference these columns throughout (not just
-- superficially) and must be rewritten to drop them BEFORE the ALTER TABLE DROP
-- COLUMN statements at the end of this file — dropping the columns first would break
-- the RPCs' own column references mid-migration.
--
-- Both functions' RETURNS TABLE shape is changing (two fewer columns), so both
-- require DROP FUNCTION IF EXISTS with their exact current signature before CREATE
-- OR REPLACE, per house rule (Postgres rejects a return-shape change otherwise).
-- Current live signatures confirmed by reading each function's full current body
-- before writing this (20260717000044_community_settings_and_rsvp_closure.sql for
-- insert_event_with_audit, 20260719000050_resync_event_attendees_on_target_edit.sql
-- for update_event_with_audit) — not assumed from an earlier snapshot. Every other
-- column/clause in both functions is carried forward completely unchanged.

-- ==============================================================
-- SECTION 1: insert_event_with_audit — drop p_prayer_leader_member_id/
-- p_food_assignment from the parameter list, RETURNS TABLE, INSERT column list,
-- VALUES list, and the final RETURN QUERY SELECT.
-- ==============================================================

DROP FUNCTION IF EXISTS public.insert_event_with_audit(UUID, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, JSONB, UUID, UUID, JSONB, UUID, TEXT, TEXT, INTEGER, UUID);

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
    p_actor_member_id UUID
)
RETURNS TABLE (
    id UUID, name TEXT, status TEXT, start_datetime TIMESTAMPTZ,
    end_datetime TIMESTAMPTZ, location_name TEXT, location_address TEXT, location_url TEXT,
    target JSONB, talk_id UUID,
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
    online_meeting_resource_id, online_meeting_url, online_meeting_platform_label,
    rsvp_closure_days
  ) VALUES (
    p_tenant_id, p_event_type_id, p_name, 'DRAFT', p_start_datetime, p_end_datetime,
    p_location_name, p_location_address, p_location_url, p_target, p_talk_id,
    p_online_meeting_resource_id, p_online_meeting_url, p_online_meeting_platform_label,
    p_rsvp_closure_days
  )
  RETURNING * INTO v_row;

  PERFORM write_audit_log(p_tenant_id, 'event', v_row.id, 'create', p_actor_member_id, NULL, to_jsonb(v_row));

  RETURN QUERY SELECT
    v_row.id, v_row.name, v_row.status, v_row.start_datetime,
    v_row.end_datetime, v_row.location_name, v_row.location_address, v_row.location_url,
    v_row.target, v_row.talk_id,
    v_row.online_meeting_resource_id, v_row.online_meeting_url, v_row.online_meeting_platform_label,
    v_row.rsvp_closure_days, v_row.created_at;
END;
$$;


-- ==============================================================
-- SECTION 2: update_event_with_audit — drop prayer_leader_member_id/food_assignment
-- from RETURNS TABLE, the two CASE WHEN p_patch ? SET clauses, and the final
-- RETURN QUERY SELECT. The FP-156 event_attendees resync block (keyed off
-- p_patch ? 'target', unrelated to either dropped column) is carried forward
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
    v_row.target, v_row.talk_id,
    v_row.online_meeting_resource_id, v_row.online_meeting_url, v_row.online_meeting_platform_label,
    v_row.rsvp_closure_days, v_row.event_type_id, v_row.updated_at;
END;
$$;


-- ==============================================================
-- SECTION 3: trigger_validate_event_prayer_leader_tenant_scope — found during
-- this migration's own implementation, NOT listed in this DIP's Grounding Check.
-- Added by 20260711000034_event_prayer_leader_food_assignment.sql as a
-- BEFORE INSERT OR UPDATE ON events trigger; its function body reads
-- NEW.prayer_leader_member_id directly. Postgres does not track a trigger as
-- depending on the specific columns its function body happens to reference
-- (only on the table itself) — DROP COLUMN prayer_leader_member_id would NOT
-- automatically drop this trigger, and every subsequent INSERT/UPDATE on
-- events would then fail at runtime ("record NEW has no field
-- prayer_leader_member_id"), breaking the entire events write path. Must be
-- dropped here, before the column itself, same ordering reasoning as the RPCs
-- above. food_assignment has no equivalent trigger to worry about —
-- 20260711000034's own header comment confirms it deliberately got no
-- write-time cross-tenant trigger (same precedent as target), only
-- prayer_leader_member_id did.
-- ==============================================================

DROP TRIGGER IF EXISTS trigger_validate_event_prayer_leader_tenant_scope ON events;
DROP FUNCTION IF EXISTS public.validate_event_prayer_leader_tenant_scope();


-- ==============================================================
-- SECTION 4: drop the columns themselves — only now that both RPCs and the
-- trigger above no longer reference them.
-- ==============================================================

ALTER TABLE events DROP COLUMN IF EXISTS prayer_leader_member_id;
ALTER TABLE events DROP COLUMN IF EXISTS food_assignment;
