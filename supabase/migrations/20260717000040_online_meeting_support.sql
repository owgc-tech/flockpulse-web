-- DIP-FP-120-web: online-meeting support for events. A tenant-scoped pool of
-- fixed Zoom accounts (meeting_resources) with DB-enforced conflict detection
-- so two events can never double-book the same account for overlapping
-- times, plus a freeform "other platform" option with no conflict tracking.
-- Purely additive — physical location stays required exactly as today.
--
-- Confirmed live before writing this (nothing assumed from a prior snapshot):
--   - insert_event_with_audit()/update_event_with_audit()'s exact current parameter
--     lists and RETURNS TABLE column sets (both established in 20260711000034,
--     unchanged since) — confirmed via direct read of that migration file, not
--     pg_get_function_arguments, since this session has filesystem access to it.
--   - update_event_with_audit() names each patch column explicitly in its body
--     (COALESCE / CASE WHEN p_patch ? 'key' per column) — it is NOT a generic
--     dynamic-key applier, so it needs the same DROP FUNCTION IF EXISTS +
--     CREATE OR REPLACE treatment as insert_event_with_audit(), not just a
--     TS-side patch-object addition.
--   - btree_gist is not yet enabled anywhere in this repo (grepped all
--     migrations for CREATE EXTENSION).
--   - events.status CHECK constraint values are DRAFT/SCHEDULED/CANCELLED
--     (20260629000009) — 'CANCELLED' is a valid literal for the partial
--     exclusion constraint's WHERE clause below.
--   - event_types' three-policy RLS shape (20260629000016) is mirrored exactly
--     for meeting_resources.
--   - Local supabase/seed.sql only seeds fake tenant ids (...0001/...0002),
--     never the real OWGC tenant id below — a hardcoded INSERT ... VALUES for
--     that tenant would violate the tenant_id FK and break `supabase db reset`
--     locally. Seeded instead via INSERT ... SELECT ... FROM tenants WHERE
--     id = <owgc>, mirroring event_types' own dynamic-seed precedent — this
--     seeds 0 rows locally (harmless, no FK violation) and the real 2 rows once
--     applied against production, where that tenant actually exists.


-- ==============================================================
-- SECTION 1: btree_gist — required for the EXCLUDE constraint in Section 6
-- (GiST index support for the UUID/text equality operators alongside the
-- tstzrange overlap operator).
-- ==============================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;


-- ==============================================================
-- SECTION 2: meeting_resources table + RLS
-- Mirrors event_types' shape exactly (20260629000016) — SELECT open to any
-- tenant member, INSERT/UPDATE restricted to caller_is_admin(). No DELETE
-- policy, no FOR ALL, same precedent.
-- ==============================================================

CREATE TABLE IF NOT EXISTS meeting_resources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    name TEXT NOT NULL,
    join_url TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE meeting_resources ENABLE ROW LEVEL SECURITY;

-- anon is deliberately excluded: no endpoint is reachable without a JWT (see migration 000011).
-- service_role is covered by ALTER DEFAULT PRIVILEGES in 000011 — no explicit grant needed.
GRANT SELECT ON meeting_resources TO authenticated;
GRANT INSERT, UPDATE ON meeting_resources TO authenticated;

DROP POLICY IF EXISTS "meeting_resources_select" ON meeting_resources;
CREATE POLICY "meeting_resources_select" ON meeting_resources
    FOR SELECT USING (tenant_id = get_tenant_id());

DROP POLICY IF EXISTS "meeting_resources_admin_insert" ON meeting_resources;
CREATE POLICY "meeting_resources_admin_insert" ON meeting_resources
    FOR INSERT WITH CHECK (tenant_id = get_tenant_id() AND caller_is_admin());

DROP POLICY IF EXISTS "meeting_resources_admin_update" ON meeting_resources;
CREATE POLICY "meeting_resources_admin_update" ON meeting_resources
    FOR UPDATE
    USING (tenant_id = get_tenant_id() AND caller_is_admin())
    WITH CHECK (tenant_id = get_tenant_id());


-- ==============================================================
-- SECTION 3: seed two Zoom accounts for the OWGC tenant
--
-- join_url values are PLACEHOLDERS — Joseph has not yet supplied the two real
-- Zoom join URLs. Flagged explicitly in the PR/completion report; replace
-- these two rows' join_url before (or immediately after) applying against
-- production.
-- ==============================================================

INSERT INTO meeting_resources (tenant_id, name, join_url)
SELECT t.id, v.name, v.join_url
FROM tenants t
CROSS JOIN (VALUES
    ('Zoom Account A', 'REPLACE_ME_ZOOM_ACCOUNT_A'),
    ('Zoom Account B', 'REPLACE_ME_ZOOM_ACCOUNT_B')
) AS v(name, join_url)
WHERE t.id = 'ccdd0d62-ba0c-40fe-9ff6-b65eaa282a42'
ON CONFLICT DO NOTHING;


-- ==============================================================
-- SECTION 4: online meeting fields on events
-- online_meeting_resource_id is the tracked-Zoom path; online_meeting_url +
-- online_meeting_platform_label together are the freeform "other platform"
-- path. Mutually exclusive at the app layer only (not a scarce-resource
-- conflict the way Zoom accounts are, so no DB-level XOR constraint).
-- ==============================================================

ALTER TABLE events ADD COLUMN IF NOT EXISTS online_meeting_resource_id UUID REFERENCES meeting_resources(id);
ALTER TABLE events ADD COLUMN IF NOT EXISTS online_meeting_url TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS online_meeting_platform_label TEXT;


-- ==============================================================
-- SECTION 5: cross-tenant trigger for online_meeting_resource_id
-- Mirrors validate_event_prayer_leader_tenant_scope() exactly — same
-- pattern, different table/column. A bare REFERENCES only proves the row
-- exists, not that it belongs to this event's tenant.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.validate_event_online_meeting_resource_tenant_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.online_meeting_resource_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM meeting_resources
      WHERE id = NEW.online_meeting_resource_id AND tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'events.online_meeting_resource_id % is invalid or belongs to a different tenant', NEW.online_meeting_resource_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_validate_event_online_meeting_resource_tenant_scope ON events;
CREATE TRIGGER trigger_validate_event_online_meeting_resource_tenant_scope
BEFORE INSERT OR UPDATE ON events
FOR EACH ROW EXECUTE FUNCTION validate_event_online_meeting_resource_tenant_scope();


-- ==============================================================
-- SECTION 6: EXCLUDE constraint — the real, race-condition-free enforcement
-- that no two events reserve the same meeting_resource for overlapping time.
-- Partial (WHERE online_meeting_resource_id IS NOT NULL AND status !=
-- 'CANCELLED') so events without an online-meeting reservation, and
-- cancelled events, never participate. tstzrange(..., '[)') matches the
-- half-open overlap semantics findMeetingResourceConflict()'s pre-check
-- query uses (start_datetime < newEnd AND end_datetime > newStart).
--
-- Wrapped in the standing idempotency guard — ADD CONSTRAINT has no
-- IF NOT EXISTS form.
-- ==============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_online_meeting_resource_no_overlap'
  ) THEN
    ALTER TABLE events ADD CONSTRAINT events_online_meeting_resource_no_overlap
      EXCLUDE USING gist (
        online_meeting_resource_id WITH =,
        tstzrange(start_datetime, end_datetime, '[)') WITH &&
      )
      WHERE (online_meeting_resource_id IS NOT NULL AND status != 'CANCELLED');
  END IF;
END $$;


-- ==============================================================
-- SECTION 7: extend insert_event_with_audit()/update_event_with_audit()
-- RETURNS TABLE column set is changing again — DROP FUNCTION IF EXISTS with
-- the exact current signature is required before CREATE OR REPLACE (Postgres
-- rejects an output-column-set change otherwise), same as every prior
-- extension of these two functions.
-- ==============================================================

DROP FUNCTION IF EXISTS public.insert_event_with_audit(UUID, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, JSONB, UUID, UUID, JSONB, UUID);
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
    p_actor_member_id UUID
)
RETURNS TABLE (
    id UUID, name TEXT, status TEXT, start_datetime TIMESTAMPTZ,
    end_datetime TIMESTAMPTZ, location_name TEXT, location_address TEXT, location_url TEXT,
    target JSONB, talk_id UUID, prayer_leader_member_id UUID, food_assignment JSONB,
    online_meeting_resource_id UUID, online_meeting_url TEXT, online_meeting_platform_label TEXT,
    created_at TIMESTAMPTZ
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
    online_meeting_resource_id, online_meeting_url, online_meeting_platform_label
  ) VALUES (
    p_tenant_id, p_event_type_id, p_name, 'DRAFT', p_start_datetime, p_end_datetime,
    p_location_name, p_location_address, p_location_url, p_target, p_talk_id,
    p_prayer_leader_member_id, p_food_assignment,
    p_online_meeting_resource_id, p_online_meeting_url, p_online_meeting_platform_label
  )
  RETURNING * INTO v_row;

  PERFORM write_audit_log(p_tenant_id, 'event', v_row.id, 'create', p_actor_member_id, NULL, to_jsonb(v_row));

  RETURN QUERY SELECT
    v_row.id, v_row.name, v_row.status, v_row.start_datetime,
    v_row.end_datetime, v_row.location_name, v_row.location_address, v_row.location_url,
    v_row.target, v_row.talk_id, v_row.prayer_leader_member_id, v_row.food_assignment,
    v_row.online_meeting_resource_id, v_row.online_meeting_url, v_row.online_meeting_platform_label,
    v_row.created_at;
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
    updated_at TIMESTAMPTZ
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
    v_row.updated_at;
END;
$$;
