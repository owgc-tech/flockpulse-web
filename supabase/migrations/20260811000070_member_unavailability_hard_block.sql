-- DIP-FP-190-web: member-unavailability data model + hard block on manual
-- task assignment, with auto-assign exempted via a session-scoped flag.
--
-- ==============================================================
-- SECTION 1: member_unavailability_ranges — self-service, member-filed.
-- No soft-delete — matches event_tasks_assignments' own hard-delete
-- precedent (confirmed live before writing this): a filed range that's
-- later removed is genuinely gone, not archived.
-- ==============================================================

CREATE TABLE IF NOT EXISTS member_unavailability_ranges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE member_unavailability_ranges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenants can access their own member unavailability ranges"
    ON member_unavailability_ranges USING (tenant_id = get_tenant_id());

CREATE INDEX IF NOT EXISTS idx_member_unavailability_ranges_member_id
    ON member_unavailability_ranges(member_id);


-- ==============================================================
-- SECTION 2: cross-tenant safety trigger — member_id must belong to the
-- same tenant_id as the range row (standing rule for every tenant-scoped
-- table with an FK to another tenant-scoped table). Mirrors
-- validate_event_prayer_leader_tenant_scope()'s exact pattern
-- (20260711000034_event_prayer_leader_food_assignment.sql).
-- ==============================================================

CREATE OR REPLACE FUNCTION public.validate_member_unavailability_ranges_tenant_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM members
    WHERE id = NEW.member_id AND tenant_id = NEW.tenant_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'member_unavailability_ranges.member_id % is invalid, soft-deleted, or belongs to a different tenant', NEW.member_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_validate_member_unavailability_ranges_tenant_scope ON member_unavailability_ranges;
CREATE TRIGGER trigger_validate_member_unavailability_ranges_tenant_scope
BEFORE INSERT OR UPDATE ON member_unavailability_ranges
FOR EACH ROW EXECUTE FUNCTION validate_member_unavailability_ranges_tenant_scope();


-- ==============================================================
-- SECTION 3: block_task_assignment_if_member_unavailable() — BEFORE INSERT
-- OR UPDATE on event_tasks_assignments. Checks only assignee->'member_ids'
-- (never group_ids), matching the story's explicit individual-only scope.
--
-- Exemption: auto_assign_task_slots() (Section 4 below) sets
-- app.skip_unavailability_check = 'true' via SET LOCAL before its own
-- inserts — this trigger honors that flag and returns immediately for that
-- one caller, so the round-robin itself runs exactly as before, no skip
-- logic of its own. SET LOCAL's scope is the calling transaction, and each
-- RPC call is its own transaction, so this can't leak into any other caller.
--
-- Event-not-found/cross-tenant is deliberately not raised here — it's
-- silently skipped (RETURN NEW) so trigger_validate_event_tasks_assignments_
-- tenant_scope (name sorts after this one alphabetically, so it still runs
-- on the same INSERT/UPDATE) raises its own, more specific error instead of
-- this trigger raising a confusing one first.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.block_task_assignment_if_member_unavailable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_event RECORD;
  v_member_ids UUID[];
  v_member_id UUID;
  v_member_name TEXT;
BEGIN
  IF current_setting('app.skip_unavailability_check', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF NEW.assignee IS NULL THEN
    RETURN NEW;
  END IF;

  v_member_ids := ARRAY(
    SELECT jsonb_array_elements_text(COALESCE(NEW.assignee->'member_ids', '[]'::jsonb))
  )::UUID[];
  IF v_member_ids IS NULL OR array_length(v_member_ids, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT start_datetime, end_datetime INTO v_event
  FROM events WHERE id = NEW.event_id AND tenant_id = NEW.tenant_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  FOREACH v_member_id IN ARRAY v_member_ids LOOP
    IF EXISTS (
      SELECT 1 FROM member_unavailability_ranges mur
      WHERE mur.tenant_id = NEW.tenant_id
        AND mur.member_id = v_member_id
        AND mur.start_date <= v_event.end_datetime::DATE
        AND mur.end_date >= v_event.start_datetime::DATE
    ) THEN
      SELECT (first_name || ' ' || last_name) INTO v_member_name
      FROM members WHERE id = v_member_id;

      RAISE EXCEPTION 'Cannot assign %: marked unavailable on this date — ask them to adjust their unavailability if this assignment is needed', COALESCE(v_member_name, 'this member');
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_block_task_assignment_if_member_unavailable ON event_tasks_assignments;
CREATE TRIGGER trigger_block_task_assignment_if_member_unavailable
BEFORE INSERT OR UPDATE ON event_tasks_assignments
FOR EACH ROW EXECUTE FUNCTION block_task_assignment_if_member_unavailable();


-- ==============================================================
-- SECTION 4: auto_assign_task_slots() — adds the SET LOCAL exemption line
-- as the first statement in the function body. No other change. Same 5-arg
-- signature and RETURNS SETOF event_tasks_assignments as the latest
-- definition (20260726000060_auto_assign_exclude_past_events.sql) — neither
-- changes here, so per the standing house rule a plain CREATE OR REPLACE
-- FUNCTION is correct, no DROP FUNCTION needed.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.auto_assign_task_slots(
    p_tenant_id UUID,
    p_task_id UUID,
    p_roster JSONB,
    p_actor_member_id UUID,
    p_event_type_ids UUID[]
)
RETURNS SETOF event_tasks_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_event_ids UUID[];
  v_roster_len INT := jsonb_array_length(p_roster);
  v_entry JSONB;
  v_type TEXT;
  v_rid UUID;
  v_new_assignee JSONB;
  v_row event_tasks_assignments%ROWTYPE;
  i INT;
BEGIN
  SET LOCAL app.skip_unavailability_check = 'true';

  IF p_event_type_ids IS NULL OR array_length(p_event_type_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  SELECT array_agg(e.id ORDER BY e.start_datetime ASC, e.id ASC)
  INTO v_event_ids
  FROM events e
  WHERE e.tenant_id = p_tenant_id
    AND e.event_type_id = ANY(p_event_type_ids)
    AND e.end_datetime >= now()
    AND public.get_event_effective_status(e.id) IN ('DRAFT', 'SCHEDULED', 'ACTIVE');

  IF v_event_ids IS NULL OR v_roster_len = 0 THEN
    RETURN;
  END IF;

  FOR i IN 1..array_length(v_event_ids, 1) LOOP
    v_entry := p_roster -> ((i - 1) % v_roster_len);
    v_type := v_entry->>'type';
    v_rid := (v_entry->>'id')::UUID;

    IF v_type = 'group' THEN
      v_new_assignee := jsonb_build_object('group_ids', jsonb_build_array(v_rid));
    ELSE
      v_new_assignee := jsonb_build_object('member_ids', jsonb_build_array(v_rid));
    END IF;

    INSERT INTO event_tasks_assignments (tenant_id, event_id, task_id, assignee)
    VALUES (p_tenant_id, v_event_ids[i], p_task_id, v_new_assignee)
    ON CONFLICT (event_id, task_id)
    DO UPDATE SET assignee = EXCLUDED.assignee, updated_at = now()
    RETURNING * INTO v_row;

    RETURN NEXT v_row;
  END LOOP;

  RETURN;
END;
$$;
