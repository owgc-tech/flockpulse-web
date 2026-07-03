DIP-FP-45 — Add event_types Table and FK Constraint on events.event_type_id
Covers: FP-45 (TECH-DEBT — Add FK constraint on events.event_type_id, event_types table never created) Epic: EPIC-3 — Event Lifecycle Management (FP-11)
Story Summary
`events.event_type_id` has been a bare `NOT NULL UUID` with zero referential integrity since the very first migration — no `event_types` table has ever existed. This DIP creates it, adds the FK plus the same tenant-scoped cross-safety trigger pattern used everywhere else in this schema, and — because the column is `NOT NULL` and every prior test fixture across this entire session has populated it with `gen_random_uuid()` — seeds a minimal default type per tenant and backfills any non-conforming existing rows before the constraint goes live, so nothing that currently works silently breaks.
Repo Target
Web — `owgc-tech/flockpulse-web`, working branch `dev`.
Grounding Check

1. AC #5's decision, made and documented here, not deferred silently: full Admin CRUD for `event_types` is not built in this DIP. Per the ticket's own Risk section, "no downstream business logic currently reads or branches on event_type_id" — there's no active need for admin-facing management yet, and building it now would turn an intentionally small tech-debt fix into a scope creep exercise. This DIP builds the table, the constraint, and a minimal migration-level seed only. A follow-up story should scope the actual CRUD when something real needs to create custom event types.
2. The `NOT NULL` + zero-existing-data combination requires seed-then-backfill, not a bare `ALTER TABLE`. Every prior test script this session that creates an `events` row (RSVP, self-report, confirmation, formation) populates `event_type_id` via `gen_random_uuid()` — confirmed directly in migration comments and CC's own prior reports ("no FK, I can use any UUID"). Adding the FK cold would break every one of those existing patterns. This DIP seeds one default `event_types` row per existing tenant, then backfills any `events` row whose current `event_type_id` doesn't resolve to a real, tenant-matched, non-deleted row — same "backfill before tightening" discipline as FP-47.
3. Future tenants are a known, deliberately-deferred gap — not silently ignored. This migration seeds a default type for tenants that exist at migration time. There's no trigger auto-seeding a default `event_types` row when a new tenant is created (tenant creation isn't a self-service flow yet — no signup CRUD exists this session). Flag this explicitly in the PR rather than let it be an invisible assumption; a future tenant-onboarding story should address it.
4. Same dual-layer validation pattern as `talk_id` (FP-29/30/43): DB trigger plus app-layer check in `createEvent`/`updateEvent`. Read the current `src/features/events/service.ts` first — it was already modified once this session for `talk_id` validation; confirm its current shape before adding to it, don't assume it's unchanged from before that DIP.
5. Canonical error code: `INVALID_TARGET` is the correct fit here, unlike the `talk_id` case where a more specific code (`INVALID_FORMATION_LINK`) existed. `event_type_id` isn't a formation-domain link; it's a general reference-validity failure, which is exactly what `INVALID_TARGET` is for. This is the case that confirms why the generic code exists.
6. RLS added now even though no CRUD calls it yet, for consistency with every other admin-managed table's security posture rather than leaving this one exposed until a follow-up CRUD story lands. `SELECT`/`INSERT`/`UPDATE` only — no `FOR ALL`, no hard-delete path, same standing rule as every table since migration `000003`.
7. No conflicts with Section 4 invariants. Pure referential-integrity fix; no business rule changes.
Implementation Plan

1. Migration:
   * Create `event_types`: `id, tenant_id, name, code, deleted_at, created_at, updated_at`, matching the Engineering Spec §3 canonical schema named in the ticket. Partial unique index on `(tenant_id, code) WHERE deleted_at IS NULL`.
   * Seed one default row per existing tenant (`name = 'General'`, `code = 'GENERAL'`).
   * Backfill: any `events` row whose `event_type_id` doesn't resolve to a real, tenant-matched, non-deleted `event_types` row gets repointed to that tenant's new default.
   * Add `events_event_type_id_fkey` FK.
   * Add `validate_event_event_type_id()` trigger — tenant match + `deleted_at IS NULL`, same shape as `validate_event_talk_id` from the prior DIP (no `IF NOT NULL` guard needed here, since the column is `NOT NULL` and always present).
   * RLS: tenant-wide `SELECT`, Admin-only `INSERT`/`UPDATE` via `caller_is_admin()` (reused, not reimplemented).
2. `src/features/events/service.ts` — read current file first. Add `event_type_id` validation to `createEvent`/`updateEvent`: confirm it references an active, non-deleted, tenant-scoped `event_types` row — `INVALID_TARGET` otherwise.
3. Regression check: confirm every existing test script that creates an `events` row (RSVP, self-report, confirmation, formation) still passes after this migration — since they all currently use `gen_random_uuid()` for `event_type_id`, they'll now need to reference the seeded default type instead. This is expected breakage to fix, not a sign something's wrong with the DIP.
Files to Create/Modify

* `supabase/migrations/20260629000016_event_types_and_fk.sql`
* `src/features/events/service.ts` (modify)
* `documentation/test-plans/FP-45-event-types-checklist.md`
Migration File
`supabase/migrations/20260629000016_event_types_and_fk.sql`

```sql
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
-- SECTION 5: RLS — added now for consistency, even though no CRUD
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
```

Branch Name
`feature/FP-45-event-types-fk`
Commit Message
`FP-45: Add event_types table and tenant-scoped FK constraint on events.event_type_id`
Pull Request Description
Maps to all 5 ACs: table created per canonical schema, FK added, tenant-safety trigger enforces cross-tenant and soft-delete rejection, existing/seed data backfilled before the constraint was applied, and AC #5's CRUD-vs-follow-up decision stated explicitly (deferred, documented, not silently skipped).
Flagged, not fixed here: no auto-seed for tenants created after this migration runs — deliberate scope boundary, follow-up work.
Jira Linkage

* PDEEpicID: FP-11 (EPIC-3 — Event Lifecycle Management)
* PDEStoryID: FP-45 (TECH-DEBT — Add FK constraint on events.event_type_id)
Stop Point
Save this DIP verbatim to `documentation/dips/DIP-FP-45.md` and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description.
Create the feature branch, read `src/features/events/service.ts` before editing it, implement, run the full regression across every prior test script that creates an `events` row (expect and fix the `gen_random_uuid()` breakage described in Grounding Check item 2 — this is expected work, not a surprise), commit, push, and open the PR against `dev`.
Open the PR against dev and stop. Do not merge — the user will check out the branch locally, test it, and merge manually.
Include full diffs for every file in your completion report per Section 5, rule 12 — not a summary.
