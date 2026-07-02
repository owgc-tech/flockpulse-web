-- DIP-FP-16-FP-17: RSVP submission (pre-event intent), reason enforcement on No,
-- tenant-scoped cross-table safety, first real caller of block_actions_on_cancelled_or_locked()


-- ==============================================================
-- SECTION 1: rsvps table
--
-- Intent-only. Never references or is referenced by any future
-- attendance-confirmation table (none exist yet — EPIC-5/6).
-- rsvp_status = 'NO' requires a non-empty rsvp_reason at the DB
-- layer as defense-in-depth; the app layer is the primary source
-- of the RSVP_REASON_REQUIRED error and must not rely on this
-- constraint firing as the user-facing validation path.
-- ==============================================================

CREATE TABLE IF NOT EXISTS rsvps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    rsvp_status TEXT NOT NULL CHECK (rsvp_status IN ('YES', 'NO')),
    rsvp_reason TEXT,
    responded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT rsvps_reason_required_check CHECK (
        rsvp_status = 'YES'
        OR (rsvp_status = 'NO' AND rsvp_reason IS NOT NULL AND btrim(rsvp_reason) <> '')
    )
);

ALTER TABLE rsvps ENABLE ROW LEVEL SECURITY;


-- ==============================================================
-- SECTION 2: Upsert-target unique index
--
-- "Latest RSVP overwrites previous" (FP-16 AC) — one active row
-- per (tenant, event, member). No soft-delete concept for RSVP;
-- the row is simply overwritten on resubmission.
-- ==============================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_rsvps_unique_event_member
    ON rsvps(tenant_id, event_id, member_id);

CREATE INDEX IF NOT EXISTS idx_rsvps_tenant_member
    ON rsvps(tenant_id, member_id);


-- ==============================================================
-- SECTION 3: Cross-tenant referential safety trigger
--
-- A bare FK to events(id)/members(id) does not verify the
-- referenced row belongs to the same tenant as the RSVP row.
-- Same class of gap flagged (for events.talk_id) in FP-43 —
-- addressed here for rsvps proactively rather than deferred.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.validate_rsvp_tenant_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM events WHERE id = NEW.event_id AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'rsvps.event_id % does not belong to tenant %', NEW.event_id, NEW.tenant_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM members WHERE id = NEW.member_id AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'rsvps.member_id % does not belong to tenant %', NEW.member_id, NEW.tenant_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_validate_rsvp_tenant_scope ON rsvps;

CREATE TRIGGER trigger_validate_rsvp_tenant_scope
BEFORE INSERT OR UPDATE ON rsvps
FOR EACH ROW EXECUTE FUNCTION validate_rsvp_tenant_scope();


-- ==============================================================
-- SECTION 4: RLS policies
--
-- SELECT: tenant-wide (matches the existing pattern on events /
--   event_attendees) — leader/admin visibility into RSVP context
--   is genuinely needed later (EPIC-6 confirmation screen, EPIC-9
--   reporting) and this avoids a second migration to widen it.
-- INSERT/UPDATE: restricted to the authenticated member's own row.
--   Members submit their own RSVP only; nothing in FP-16/FP-17
--   grants leader/admin write access to another member's RSVP.
-- ==============================================================

CREATE POLICY "rsvps_select" ON rsvps
    FOR SELECT
    USING (tenant_id = get_tenant_id());

CREATE POLICY "rsvps_insert_self" ON rsvps
    FOR INSERT
    WITH CHECK (
        tenant_id = get_tenant_id()
        AND EXISTS (
            SELECT 1 FROM members m
            WHERE m.id = member_id
              AND m.user_id = auth.uid()
              AND m.tenant_id = get_tenant_id()
              AND m.deleted_at IS NULL
        )
    );

CREATE POLICY "rsvps_update_self" ON rsvps
    FOR UPDATE
    USING (
        tenant_id = get_tenant_id()
        AND EXISTS (
            SELECT 1 FROM members m
            WHERE m.id = member_id
              AND m.user_id = auth.uid()
              AND m.tenant_id = get_tenant_id()
              AND m.deleted_at IS NULL
        )
    )
    WITH CHECK (tenant_id = get_tenant_id());
