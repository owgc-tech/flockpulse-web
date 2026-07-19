-- DIP-FP-161-1: task foundation — tasks catalog + event_tasks_assignments.
-- Phase 1 of 5 for FP-161 (Dynamic Event Task system). Not wired into the
-- Event Form yet (Phase 3) — this is schema + admin CRUD for the catalog
-- only, plus the assignment table's shape.
--
-- Grounding correction (flagged back to and confirmed by the DIP author
-- before writing this): the DIP's Grounding Check named
-- create_event_type_with_audit()/update_event_type_with_audit() as the
-- precedent to mirror. No such functions exist anywhere in migration
-- history — confirmed via full grep. event_types' actual live stack
-- (migration 20260629000016 + event-type.service.ts/repository.ts) uses a
-- plain service-role-client repository doing direct table INSERT/UPDATE,
-- gated by requireRole('ADMIN') at the API layer, with NO SECURITY DEFINER
-- audit RPC and no write_audit_log() call. That create_X_with_audit/
-- update_X_with_audit-RPC-plus-audit-log pattern is real, but it's groups'
-- (create_group_with_audit/update_group_with_audit, migration
-- 20260713000036), not event_types'. Confirmed with the user: mirror
-- event_types' actual live code (no audit RPC), not the DIP's mistaken
-- description of it.
--
-- Confirmed live before writing this:
--   - events has exactly one RLS policy — "Tenants can access their own
--     events" — tenant-scoped only, no role gating in SQL at all. Leader-
--     tier-or-above write gating for prayer_leader_member_id/
--     food_assignment happens entirely at the API layer (requireRole
--     ('LEADER') in app/api/events/route.ts and app/api/events/[id]/
--     route.ts). event_attendees mirrors that same tenant-scoped-only
--     shape (single policy, no FOR clause = applies to all commands).
--     event_tasks_assignments below follows that same precedent: a single
--     tenant-scoped RLS policy, Leader-tier-or-above enforced in the
--     app/api layer, not in SQL — consistent with how the two fields this
--     feature will eventually replace are gated today.
--   - groups has no deleted_at column — group_ids in the assignee JSONB
--     are validated tenant-scoped only (no soft-delete check), members
--     does have deleted_at and is checked, matching
--     validatePrayerLeaderMemberId()'s existing precedent in
--     src/features/events/service.ts.

-- ==============================================================
-- SECTION 1: tasks table (mirrors event_types minus the code column —
-- nothing in this DIP's scope branches on a stable code the way
-- event_types' FORMATION check does; name alone is sufficient).
-- ==============================================================

CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;


-- ==============================================================
-- SECTION 2: seed three default tasks rows per existing tenant, so Phase 3
-- has real catalog rows to reference by name. Mirrors event_types'
-- original migration seeding a "General" default type.
-- ==============================================================

INSERT INTO tasks (tenant_id, name)
SELECT tenants.id, seed.name
FROM tenants, (VALUES ('Prayer Leader'), ('Food Assignment'), ('Music')) AS seed(name)
ON CONFLICT DO NOTHING;


-- ==============================================================
-- SECTION 3: event_tasks_assignments — links an event's task to whoever's
-- assigned. assignee JSONB reuses the exact { group_ids, member_ids } shape
-- already used by events.target/events.food_assignment. No soft-delete —
-- deliberately mirrors event_attendees' hard-delete precedent (confirmed
-- during FP-156); the standing audit_log mechanism covers history if ever
-- needed.
-- ==============================================================

CREATE TABLE IF NOT EXISTS event_tasks_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    task_id UUID NOT NULL REFERENCES tasks(id),
    assignee JSONB,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE event_tasks_assignments ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_event_tasks_assignments_event_id
    ON event_tasks_assignments(event_id);


-- ==============================================================
-- SECTION 4: cross-tenant safety trigger — event_id and task_id must both
-- belong to the same tenant_id as the assignment row (standing rule for
-- every tenant-scoped table with FKs to other tenant-scoped tables).
-- assignee's group_ids/member_ids are not real FK columns (same as
-- target/food_assignment today) — their tenant-membership validation
-- happens at the app/service layer, not here.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.validate_event_tasks_assignments_tenant_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM events
    WHERE id = NEW.event_id AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'event_tasks_assignments.event_id % is invalid or belongs to a different tenant', NEW.event_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM tasks
    WHERE id = NEW.task_id AND tenant_id = NEW.tenant_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'event_tasks_assignments.task_id % is invalid, soft-deleted, or belongs to a different tenant', NEW.task_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_validate_event_tasks_assignments_tenant_scope ON event_tasks_assignments;
CREATE TRIGGER trigger_validate_event_tasks_assignments_tenant_scope
BEFORE INSERT OR UPDATE ON event_tasks_assignments
FOR EACH ROW EXECUTE FUNCTION validate_event_tasks_assignments_tenant_scope();


-- ==============================================================
-- SECTION 5: table privileges. anon is deliberately excluded — no endpoint
-- is reachable without a JWT (see migration 000011). service_role is
-- covered by ALTER DEFAULT PRIVILEGES in 000011 — no explicit grant needed.
-- ==============================================================

GRANT SELECT ON tasks TO authenticated;
GRANT INSERT, UPDATE ON tasks TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON event_tasks_assignments TO authenticated;


-- ==============================================================
-- SECTION 6: RLS.
-- tasks mirrors event_types exactly — SELECT open to all tenant members,
-- INSERT/UPDATE Admin-tier only via caller_is_admin(), no hard-delete.
-- event_tasks_assignments mirrors event_attendees' shape — a single
-- tenant-scoped policy covering all commands; Leader-tier-or-above write
-- gating happens at the API layer (see header note), not here, since this
-- DIP does not yet know about owner_member_id (Phase 2) and events itself
-- gates the fields this table will eventually replace the same way.
-- ==============================================================

CREATE POLICY "tasks_select" ON tasks
    FOR SELECT USING (tenant_id = get_tenant_id());
CREATE POLICY "tasks_admin_insert" ON tasks
    FOR INSERT WITH CHECK (tenant_id = get_tenant_id() AND caller_is_admin());
CREATE POLICY "tasks_admin_update" ON tasks
    FOR UPDATE
    USING (tenant_id = get_tenant_id() AND caller_is_admin())
    WITH CHECK (tenant_id = get_tenant_id());

CREATE POLICY "event_tasks_assignments_tenant_access" ON event_tasks_assignments
    USING (tenant_id = get_tenant_id());
