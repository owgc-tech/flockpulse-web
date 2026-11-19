-- DIP-FP-76/82/83/84/85/86: Formation admin — alias/description on all three tables,
-- demographic relevance flags on talks, deletion guards for courses/modules, and
-- atomic two-phase reorder functions.

-- ==============================================================
-- SECTION 1: alias + description columns (FP-82)
-- ==============================================================

ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS alias TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT;

ALTER TABLE modules
  ADD COLUMN IF NOT EXISTS alias TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT;

ALTER TABLE talks
  ADD COLUMN IF NOT EXISTS alias TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT;


-- ==============================================================
-- SECTION 2: Demographic relevance flags on talks (FP-76)
-- ==============================================================

ALTER TABLE talks
  ADD COLUMN IF NOT EXISTS for_single_men   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS for_single_women BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS for_married_men  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS for_married_women BOOLEAN NOT NULL DEFAULT false;

-- Backfill existing talks to all-audiences so they satisfy the CHECK.
-- Any pre-existing row with all false would violate the constraint;
-- marking all four true is the safest fully-inclusive default for legacy data.
UPDATE talks
  SET for_single_men = true, for_single_women = true,
      for_married_men = true, for_married_women = true
  WHERE NOT (for_single_men OR for_single_women OR for_married_men OR for_married_women);

-- Add CHECK constraint idempotently (NOT VALID skips retroactive row scan;
-- the backfill above already guarantees existing rows are conformant, but
-- NOT VALID avoids a full-table lock on large datasets in production).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'talks'::regclass
      AND conname = 'talks_at_least_one_demographic'
  ) THEN
    ALTER TABLE talks ADD CONSTRAINT talks_at_least_one_demographic
      CHECK (for_single_men OR for_single_women OR for_married_men OR for_married_women)
      NOT VALID;
    ALTER TABLE talks VALIDATE CONSTRAINT talks_at_least_one_demographic;
  END IF;
END $$;


-- ==============================================================
-- SECTION 3: Course deletion guard (FP-85)
--
-- Blocks soft-delete of a Course while it has any active (non-deleted)
-- Modules. Mirrors block_talk_deletion_if_referenced's structure but
-- guards the child-based hierarchy, not event references.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.validate_course_deletion_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    IF EXISTS (SELECT 1 FROM modules WHERE course_id = NEW.id AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Cannot soft-delete course %: it has one or more active modules — soft-delete all modules first', NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_validate_course_deletion_guard ON courses;
CREATE TRIGGER trigger_validate_course_deletion_guard
BEFORE UPDATE ON courses
FOR EACH ROW EXECUTE FUNCTION validate_course_deletion_guard();


-- ==============================================================
-- SECTION 4: Module deletion guard (FP-85)
--
-- Blocks soft-delete of a Module while it has any active Talks.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.validate_module_deletion_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    IF EXISTS (SELECT 1 FROM talks WHERE module_id = NEW.id AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Cannot soft-delete module %: it has one or more active talks — soft-delete all talks first', NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_validate_module_deletion_guard ON modules;
CREATE TRIGGER trigger_validate_module_deletion_guard
BEFORE UPDATE ON modules
FOR EACH ROW EXECUTE FUNCTION validate_module_deletion_guard();


-- ==============================================================
-- SECTION 5: Atomic two-phase reorder functions (FP-86)
--
-- The unique indexes on sequence_order are non-deferrable partial indexes.
-- A naïve single-pass UPDATE risks transient collisions between rows whose
-- old value equals another row's new value within the same statement.
-- Two-phase solution: first shift all affected rows to negative out-of-range
-- values (guaranteed unique among themselves and guaranteed not to clash with
-- any positive value in the live set), then set the real final values.
-- Both phases happen inside the same function body, same transaction.
--
-- Each function independently verifies every supplied ID belongs to the given
-- tenant (and correct parent for modules/talks) before touching any row.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.reorder_courses(p_tenant_id UUID, p_ids UUID[])
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_count INT;
  v_pos   INT;
BEGIN
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'p_ids must be a non-empty array';
  END IF;

  -- Verify every ID belongs to this tenant and is not deleted.
  SELECT COUNT(*) INTO v_count
    FROM courses
   WHERE id = ANY(p_ids)
     AND tenant_id = p_tenant_id
     AND deleted_at IS NULL;

  IF v_count != array_length(p_ids, 1) THEN
    RAISE EXCEPTION 'One or more course IDs are invalid, deleted, or belong to a different tenant';
  END IF;

  -- Phase 1: move to negative out-of-range to clear collision space.
  FOR v_pos IN 1..array_length(p_ids, 1) LOOP
    UPDATE courses
       SET sequence_order = -(v_pos)
     WHERE id = p_ids[v_pos] AND tenant_id = p_tenant_id;
  END LOOP;

  -- Phase 2: set final sequential positions.
  FOR v_pos IN 1..array_length(p_ids, 1) LOOP
    UPDATE courses
       SET sequence_order = v_pos
     WHERE id = p_ids[v_pos] AND tenant_id = p_tenant_id;
  END LOOP;
END;
$$;


CREATE OR REPLACE FUNCTION public.reorder_modules(
  p_course_id UUID, p_tenant_id UUID, p_ids UUID[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_count INT;
  v_pos   INT;
BEGIN
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'p_ids must be a non-empty array';
  END IF;

  SELECT COUNT(*) INTO v_count
    FROM modules
   WHERE id = ANY(p_ids)
     AND tenant_id = p_tenant_id
     AND course_id = p_course_id
     AND deleted_at IS NULL;

  IF v_count != array_length(p_ids, 1) THEN
    RAISE EXCEPTION 'One or more module IDs are invalid, deleted, or do not belong to the specified course/tenant';
  END IF;

  FOR v_pos IN 1..array_length(p_ids, 1) LOOP
    UPDATE modules
       SET sequence_order = -(v_pos)
     WHERE id = p_ids[v_pos] AND tenant_id = p_tenant_id AND course_id = p_course_id;
  END LOOP;

  FOR v_pos IN 1..array_length(p_ids, 1) LOOP
    UPDATE modules
       SET sequence_order = v_pos
     WHERE id = p_ids[v_pos] AND tenant_id = p_tenant_id AND course_id = p_course_id;
  END LOOP;
END;
$$;


CREATE OR REPLACE FUNCTION public.reorder_talks(
  p_module_id UUID, p_tenant_id UUID, p_ids UUID[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_count INT;
  v_pos   INT;
BEGIN
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'p_ids must be a non-empty array';
  END IF;

  SELECT COUNT(*) INTO v_count
    FROM talks
   WHERE id = ANY(p_ids)
     AND tenant_id = p_tenant_id
     AND module_id = p_module_id
     AND deleted_at IS NULL;

  IF v_count != array_length(p_ids, 1) THEN
    RAISE EXCEPTION 'One or more talk IDs are invalid, deleted, or do not belong to the specified module/tenant';
  END IF;

  FOR v_pos IN 1..array_length(p_ids, 1) LOOP
    UPDATE talks
       SET sequence_order = -(v_pos)
     WHERE id = p_ids[v_pos] AND tenant_id = p_tenant_id AND module_id = p_module_id;
  END LOOP;

  FOR v_pos IN 1..array_length(p_ids, 1) LOOP
    UPDATE talks
       SET sequence_order = v_pos
     WHERE id = p_ids[v_pos] AND tenant_id = p_tenant_id AND module_id = p_module_id;
  END LOOP;
END;
$$;
