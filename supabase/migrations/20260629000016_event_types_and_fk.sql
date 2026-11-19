-- FP-45: events.event_type_id has been a bare NOT NULL UUID with zero referential
-- integrity since migration 000002 — no event_types table has ever existed. This
-- migration creates it, seeds a default row per existing tenant, backfills any
-- non-conforming events rows, then adds the FK and tenant-safety trigger.
--
-- AC #5 decision (documented, not deferred silently): full Admin CRUD for
-- event_types is NOT built here. No downstream business logic currently reads
-- event_type_id, so there's no active need — a follow-up story should scope
-- CRUD when something real requires custom event types.
--
-- Known gap, deliberately deferred: this seeds existing tenants only. No trigger
-- auto-seeds a default event_types row for tenants created after this migration
-- runs — tenant creation isn't a self-service flow yet. Future tenant-onboarding
-- work should address this.


-- ==============================================================
-- SECTION 1: event_types table
-- ==============================================================

CREATE TABLE IF NOT EXISTS event_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE event_types ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_types_unique_code
    ON event_types(tenant_id, code) WHERE deleted_at IS NULL;


-- ==============================================================
-- SECTION 2: Seed a default type per existing tenant
-- ==============================================================

INSERT INTO event_types (tenant_id, name, code)
SELECT id, 'General', 'GENERAL' FROM tenants
ON CONFLICT DO NOTHING;


-- ==============================================================
-- SECTION 3: Backfill non-conforming events.event_type_id values
--
-- Every prior test fixture this session populated event_type_id via
-- gen_random_uuid() with no real event_types row backing it — this
-- repoints any such row to its tenant's new default before the FK
-- makes that impossible.
-- ==============================================================

UPDATE events e
SET event_type_id = (
    SELECT et.id FROM event_types et
    WHERE et.tenant_id = e.tenant_id AND et.code = 'GENERAL'
)
WHERE NOT EXISTS (
    SELECT 1 FROM event_types et
    WHERE et.id = e.event_type_id AND et.tenant_id = e.tenant_id AND et.deleted_at IS NULL
);


-- ==============================================================
-- SECTION 4: FK + tenant-safety trigger
-- ==============================================================

ALTER TABLE events
    ADD CONSTRAINT events_event_type_id_fkey FOREIGN KEY (event_type_id) REFERENCES event_types(id);

CREATE OR REPLACE FUNCTION public.validate_event_event_type_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- No NULL guard needed: event_type_id is NOT NULL on the events table.
  IF NOT EXISTS (
    SELECT 1 FROM event_types
    WHERE id = NEW.event_type_id AND tenant_id = NEW.tenant_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'events.event_type_id % is invalid, soft-deleted, or belongs to a different tenant', NEW.event_type_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_validate_event_event_type_id ON events;
CREATE TRIGGER trigger_validate_event_event_type_id
BEFORE INSERT OR UPDATE ON events
FOR EACH ROW EXECUTE FUNCTION validate_event_event_type_id();


-- ==============================================================
-- SECTION 5: Table privileges
-- ==============================================================

-- anon is deliberately excluded: no endpoint is reachable without a JWT (see migration 000011).
-- service_role is covered by ALTER DEFAULT PRIVILEGES in 000011 — no explicit grant needed.
GRANT SELECT ON event_types TO authenticated;
GRANT INSERT, UPDATE ON event_types TO authenticated;


-- ==============================================================
-- SECTION 6: RLS — added now for consistency, even though no CRUD
-- calls it yet. SELECT/INSERT/UPDATE only, no FOR ALL, no hard-delete.
-- ==============================================================

CREATE POLICY "event_types_select" ON event_types
    FOR SELECT USING (tenant_id = get_tenant_id());
CREATE POLICY "event_types_admin_insert" ON event_types
    FOR INSERT WITH CHECK (tenant_id = get_tenant_id() AND caller_is_admin());
CREATE POLICY "event_types_admin_update" ON event_types
    FOR UPDATE
    USING (tenant_id = get_tenant_id() AND caller_is_admin())
    WITH CHECK (tenant_id = get_tenant_id());
