-- DIP-FP-29-FP-30-FP-43: Formation structure (Course/Module/Talk), event-talk linkage
-- with tenant-scoped FK safety and soft-delete rejection (closes FP-43), and Talk
-- deletion-blocking when referenced by any event (any status).


-- ==============================================================
-- SECTION 1: courses, modules, talks
-- ==============================================================

CREATE TABLE IF NOT EXISTS courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sequence_order INT NOT NULL,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE courses ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS idx_courses_unique_sequence
    ON courses(tenant_id, sequence_order) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS modules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES courses(id),
    name TEXT NOT NULL,
    sequence_order INT NOT NULL,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE modules ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS idx_modules_unique_sequence
    ON modules(course_id, sequence_order) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS talks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    module_id UUID NOT NULL REFERENCES modules(id),
    name TEXT NOT NULL,
    sequence_order INT NOT NULL,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE talks ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS idx_talks_unique_sequence
    ON talks(module_id, sequence_order) WHERE deleted_at IS NULL;


-- ==============================================================
-- SECTION 2: Cross-tenant safety triggers (module → course, talk → module)
-- ==============================================================

CREATE OR REPLACE FUNCTION public.validate_module_tenant_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM courses WHERE id = NEW.course_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'modules.course_id % does not belong to tenant %', NEW.course_id, NEW.tenant_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_validate_module_tenant_scope ON modules;
CREATE TRIGGER trigger_validate_module_tenant_scope
BEFORE INSERT OR UPDATE ON modules
FOR EACH ROW EXECUTE FUNCTION validate_module_tenant_scope();

CREATE OR REPLACE FUNCTION public.validate_talk_tenant_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM modules WHERE id = NEW.module_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'talks.module_id % does not belong to tenant %', NEW.module_id, NEW.tenant_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_validate_talk_tenant_scope ON talks;
CREATE TRIGGER trigger_validate_talk_tenant_scope
BEFORE INSERT OR UPDATE ON talks
FOR EACH ROW EXECUTE FUNCTION validate_talk_tenant_scope();


-- ==============================================================
-- SECTION 3: Talk deletion guard (WP-9 step 2)
--
-- Blocks soft-delete if ANY event references this talk, regardless of
-- status — not just non-cancelled. This deliberately covers two concerns
-- with one rule: (a) don't orphan an event's talk_id, and (b) don't let
-- a member's demonstrated ATTENDED completion history silently vanish
-- from formation-progress reporting.
--
-- (b) depends entirely on talk_id becoming IMMUTABLE once an event's
-- notifications are dispatched (existing FP-14 behavior, src/features/
-- events/service.ts). Because of that immutability, any attendance row
-- tracing through an event always traces through an event whose talk_id
-- still points here — so this guard's completion-history protection is
-- INHERITED from that immutability guarantee, not independently enforced.
-- If FP-14's talk_id immutability logic is ever weakened or removed,
-- this protection silently weakens with it. Do not remove or loosen
-- talk_id immutability without re-examining this guard.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.block_talk_deletion_if_referenced()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    IF EXISTS (SELECT 1 FROM events WHERE talk_id = NEW.id) THEN
      RAISE EXCEPTION 'Cannot soft-delete talk %: referenced by one or more events (any status) — see trigger comment for why this also protects member completion history', NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_block_talk_deletion_if_referenced ON talks;
CREATE TRIGGER trigger_block_talk_deletion_if_referenced
BEFORE UPDATE ON talks
FOR EACH ROW EXECUTE FUNCTION block_talk_deletion_if_referenced();


-- ==============================================================
-- SECTION 4: events.talk_id FK + tenant/soft-delete safety (closes FP-43, FP-29 AC 2)
-- ==============================================================

ALTER TABLE events
    ADD CONSTRAINT events_talk_id_fkey FOREIGN KEY (talk_id) REFERENCES talks(id);

CREATE OR REPLACE FUNCTION public.validate_event_talk_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.talk_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM talks
      WHERE id = NEW.talk_id AND tenant_id = NEW.tenant_id AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'events.talk_id % is invalid, soft-deleted, or belongs to a different tenant', NEW.talk_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_validate_event_talk_id ON events;
CREATE TRIGGER trigger_validate_event_talk_id
BEFORE INSERT OR UPDATE ON events
FOR EACH ROW EXECUTE FUNCTION validate_event_talk_id();


-- ==============================================================
-- SECTION 5: Table privileges (anon + authenticated read; authenticated write)
-- ==============================================================

GRANT SELECT ON courses TO anon, authenticated;
GRANT INSERT, UPDATE ON courses TO authenticated;

GRANT SELECT ON modules TO anon, authenticated;
GRANT INSERT, UPDATE ON modules TO authenticated;

GRANT SELECT ON talks TO anon, authenticated;
GRANT INSERT, UPDATE ON talks TO authenticated;


-- ==============================================================
-- SECTION 6: RLS — tenant-wide SELECT, Admin-only INSERT/UPDATE
--
-- Deliberately SELECT/INSERT/UPDATE only, never FOR ALL or a DELETE
-- policy — same standing rule as members/assignments since migration
-- 000003: soft-delete via UPDATE is the only supported removal path.
-- FOR ALL would combine with migration 000011's blanket DELETE grant
-- to allow real hard-delete via direct Supabase access, breaking every
-- soft-delete guarantee this DIP builds (including the talk deletion
-- guard in Section 3, which only fires on UPDATE, not DELETE).
-- ==============================================================

CREATE POLICY "courses_select" ON courses
    FOR SELECT USING (tenant_id = get_tenant_id());
CREATE POLICY "courses_admin_insert" ON courses
    FOR INSERT WITH CHECK (tenant_id = get_tenant_id() AND caller_is_admin());
CREATE POLICY "courses_admin_update" ON courses
    FOR UPDATE
    USING (tenant_id = get_tenant_id() AND caller_is_admin())
    WITH CHECK (tenant_id = get_tenant_id());

CREATE POLICY "modules_select" ON modules
    FOR SELECT USING (tenant_id = get_tenant_id());
CREATE POLICY "modules_admin_insert" ON modules
    FOR INSERT WITH CHECK (tenant_id = get_tenant_id() AND caller_is_admin());
CREATE POLICY "modules_admin_update" ON modules
    FOR UPDATE
    USING (tenant_id = get_tenant_id() AND caller_is_admin())
    WITH CHECK (tenant_id = get_tenant_id());

CREATE POLICY "talks_select" ON talks
    FOR SELECT USING (tenant_id = get_tenant_id());
CREATE POLICY "talks_admin_insert" ON talks
    FOR INSERT WITH CHECK (tenant_id = get_tenant_id() AND caller_is_admin());
CREATE POLICY "talks_admin_update" ON talks
    FOR UPDATE
    USING (tenant_id = get_tenant_id() AND caller_is_admin())
    WITH CHECK (tenant_id = get_tenant_id());
