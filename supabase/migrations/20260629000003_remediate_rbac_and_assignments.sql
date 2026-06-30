-- DIP-FP-REMEDIATION-1: Schema remediation pass
-- Covers: FP-6, FP-7, FP-9, FP-10, FP-12


-- ==============================================================
-- SECTION 1: members RLS — replace permissive FOR ALL policy
-- with granular SELECT/INSERT/UPDATE only. No DELETE policy is
-- created intentionally: soft-delete via UPDATE is the only
-- supported removal path. Hard-deleting a member row has no
-- legitimate product use case and would bypass audit trails.
-- ==============================================================

DROP POLICY IF EXISTS "member_isolation_policy" ON members;
DROP POLICY IF EXISTS "Members are visible to members of the same tenant" ON members;

-- Non-admin roles see only active (non-deleted) members of their tenant.
CREATE POLICY "members_select" ON members
    FOR SELECT
    USING (tenant_id = get_tenant_id() AND deleted_at IS NULL);

-- Admin can see all members including soft-deleted (needed for audit/restore).
CREATE POLICY "members_select_admin_all" ON members
    FOR SELECT
    USING (
        tenant_id = get_tenant_id()
        AND EXISTS (
            SELECT 1 FROM members m
            WHERE m.user_id = auth.uid()
              AND m.tenant_id = get_tenant_id()
              AND m.role = 'ADMIN'
              AND m.deleted_at IS NULL
        )
    );

-- Only admin can insert new members.
CREATE POLICY "members_insert_admin" ON members
    FOR INSERT
    WITH CHECK (
        tenant_id = get_tenant_id()
        AND EXISTS (
            SELECT 1 FROM members m
            WHERE m.user_id = auth.uid()
              AND m.tenant_id = get_tenant_id()
              AND m.role = 'ADMIN'
              AND m.deleted_at IS NULL
        )
    );

-- Admin can update any member regardless of deleted_at (required to perform
-- the soft-delete UPDATE SET deleted_at = now() itself).
CREATE POLICY "members_update_admin" ON members
    FOR UPDATE
    USING (
        tenant_id = get_tenant_id()
        AND EXISTS (
            SELECT 1 FROM members m
            WHERE m.user_id = auth.uid()
              AND m.tenant_id = get_tenant_id()
              AND m.role = 'ADMIN'
              AND m.deleted_at IS NULL
        )
    )
    WITH CHECK (tenant_id = get_tenant_id());

-- Members can update their own profile (non-role fields only — role escalation
-- is prevented at the application layer, not the policy level).
CREATE POLICY "members_update_self" ON members
    FOR UPDATE
    USING (
        tenant_id = get_tenant_id()
        AND user_id = auth.uid()
        AND deleted_at IS NULL
    )
    WITH CHECK (tenant_id = get_tenant_id());


-- ==============================================================
-- SECTION 2: groups — add INSERT policy (Admin-only, tenant-scoped)
-- ==============================================================

CREATE POLICY "groups_insert_admin" ON groups
    FOR INSERT
    WITH CHECK (
        tenant_id = get_tenant_id()
        AND EXISTS (
            SELECT 1 FROM members m
            WHERE m.user_id = auth.uid()
              AND m.tenant_id = get_tenant_id()
              AND m.role = 'ADMIN'
              AND m.deleted_at IS NULL
        )
    );

CREATE POLICY "groups_update_admin" ON groups
    FOR UPDATE
    USING (tenant_id = get_tenant_id())
    WITH CHECK (
        tenant_id = get_tenant_id()
        AND EXISTS (
            SELECT 1 FROM members m
            WHERE m.user_id = auth.uid()
              AND m.tenant_id = get_tenant_id()
              AND m.role = 'ADMIN'
              AND m.deleted_at IS NULL
        )
    );


-- ==============================================================
-- SECTION 3: assignments — redesign target_id polymorphism
-- Replace single nullable target_id with typed FKs + CHECK constraint.
-- Add soft-delete. Fix SELECT policy to exclude soft-deleted rows.
-- ==============================================================

-- 3a. Add new columns before dropping old constraint.
ALTER TABLE assignments
    ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES groups(id),
    ADD COLUMN IF NOT EXISTS leader_member_id UUID REFERENCES members(id),
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- 3b. Backfill: populate typed FK columns from polymorphic target_id.
-- GROUP assignments: target_id was a groups.id reference.
UPDATE assignments
SET group_id = target_id
WHERE assignment_type = 'GROUP'
  AND group_id IS NULL;

-- LEADER assignments: target_id was a members.id reference (the leader being assigned).
UPDATE assignments
SET leader_member_id = target_id
WHERE assignment_type = 'LEADER'
  AND leader_member_id IS NULL;

-- 3c. Drop the old polymorphic column and its non-partial unique constraint.
ALTER TABLE assignments DROP CONSTRAINT IF EXISTS assignments_member_id_target_id_key;
ALTER TABLE assignments DROP COLUMN IF EXISTS target_id;

-- 3d. Enforce exactly-one-FK via CHECK.
ALTER TABLE assignments
    ADD CONSTRAINT assignments_typed_fk_check CHECK (
        (assignment_type = 'GROUP'  AND group_id IS NOT NULL AND leader_member_id IS NULL)
        OR
        (assignment_type = 'LEADER' AND leader_member_id IS NOT NULL AND group_id IS NULL)
    );

-- 3e. Partial unique indexes replace the old UNIQUE(member_id, target_id).
--     Scoped to active (non-deleted) rows only.
CREATE UNIQUE INDEX IF NOT EXISTS idx_assignments_unique_active_group
    ON assignments(member_id, group_id)
    WHERE deleted_at IS NULL AND assignment_type = 'GROUP';

CREATE UNIQUE INDEX IF NOT EXISTS idx_assignments_unique_active_leader
    ON assignments(member_id, leader_member_id)
    WHERE deleted_at IS NULL AND assignment_type = 'LEADER';

-- 3f. Fix SELECT policy: update to exclude soft-deleted assignments.
--     This closes the same class of bug as the original members regression —
--     the column was added and used in unique indexes but the read path was
--     not updated, meaning removed assignments would still appear as active.
DROP POLICY IF EXISTS "Assignments are visible to members of the same tenant" ON assignments;

CREATE POLICY "assignments_select" ON assignments
    FOR SELECT
    USING (tenant_id = get_tenant_id() AND deleted_at IS NULL);

-- 3g. INSERT policy: Admin-only, tenant-scoped.
CREATE POLICY "assignments_insert_admin" ON assignments
    FOR INSERT
    WITH CHECK (
        tenant_id = get_tenant_id()
        AND EXISTS (
            SELECT 1 FROM members m
            WHERE m.user_id = auth.uid()
              AND m.tenant_id = get_tenant_id()
              AND m.role = 'ADMIN'
              AND m.deleted_at IS NULL
        )
    );

-- 3h. UPDATE policy: Admin-only (for soft-delete via SET deleted_at = now()).
--     Must be reachable regardless of deleted_at state (same reason as members_update_admin).
CREATE POLICY "assignments_update_admin" ON assignments
    FOR UPDATE
    USING (
        tenant_id = get_tenant_id()
        AND EXISTS (
            SELECT 1 FROM members m
            WHERE m.user_id = auth.uid()
              AND m.tenant_id = get_tenant_id()
              AND m.role = 'ADMIN'
              AND m.deleted_at IS NULL
        )
    )
    WITH CHECK (tenant_id = get_tenant_id());


-- ==============================================================
-- SECTION 4: handle_event_scheduling() — fix trigger function
-- - Reference group_id (not target_id, which no longer exists)
-- - Filter assignment_type = 'GROUP' and deleted_at IS NULL
--   (a removed assignment must not pull members onto an event roster)
-- - Re-state SET search_path (CREATE OR REPLACE drops prior clause)
-- ==============================================================

CREATE OR REPLACE FUNCTION handle_event_scheduling()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'SCHEDULED' AND OLD.status = 'DRAFT' THEN
    INSERT INTO event_attendees (tenant_id, event_id, member_id)
    SELECT NEW.tenant_id, NEW.id, a.member_id
    FROM assignments a
    WHERE a.group_id = (NEW.target->>'group_id')::UUID
      AND a.assignment_type = 'GROUP'
      AND a.deleted_at IS NULL
      AND a.tenant_id = NEW.tenant_id
    ON CONFLICT DO NOTHING;

    INSERT INTO event_notifications (tenant_id, event_id, purpose, scheduled_for) VALUES
    (NEW.tenant_id, NEW.id, 'PRE_EVENT_REMINDER',      NEW.start_datetime - INTERVAL '24 hours'),
    (NEW.tenant_id, NEW.id, 'POST_EVENT_SELF_REPORT',  NEW.end_datetime),
    (NEW.tenant_id, NEW.id, 'LEADER_CONFIRMATION',     NEW.end_datetime + INTERVAL '2 hours');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog;


-- ==============================================================
-- SECTION 5: events.status — expand CHECK to full lifecycle
-- ==============================================================

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_status_check;
ALTER TABLE events
    ADD CONSTRAINT events_status_check
    CHECK (status IN ('DRAFT', 'SCHEDULED', 'ACTIVE', 'COMPLETED', 'LOCKED', 'CANCELLED'));


-- ==============================================================
-- SECTION 6: get_tenant_id() documentation comment
-- Extracts tenant_id from the Supabase JWT via auth.jwt().
-- The JWT must include a custom claim "tenant_id" (UUID string).
-- This is set at sign-in time by the auth hook / service role call.
-- DO NOT use current_setting('app.tenant_id') — that approach
-- requires explicit SET before each query and is not set by Supabase
-- Auth's JWT pipeline.
-- ==============================================================

COMMENT ON FUNCTION public.get_tenant_id() IS
    'Extracts tenant_id UUID from the Supabase JWT custom claim "tenant_id" via auth.jwt(). '
    'Tenant claim must be injected at sign-in; never rely on current_setting() approach.';
