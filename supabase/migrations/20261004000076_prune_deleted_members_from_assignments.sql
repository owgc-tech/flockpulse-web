-- FP-234-web: deleted / deactivated members must not linger inside task
-- assignments.
--
-- A deleted or deactivated member (members.deleted_at set — by the admin Members
-- page via softDeleteMember() AND by the in-app account deletion via
-- deleteOwnAccount(); both are a single UPDATE that sets the same column) was
-- left inside event_tasks_assignments.assignee. They are invisible in the pickers
-- and made every save of that task fail validation.
--
-- This migration (a) cleans up the stale ids that exist today, idempotently, and
-- (b) installs a trigger so it cannot happen again.
--
-- Two existing triggers on event_tasks_assignments shape how rows may be written
-- here, and both are accounted for:
--   * trigger_block_task_assignment_if_member_unavailable (BEFORE INSERT OR
--     UPDATE) would reject removing a member from a task whenever ANOTHER
--     assignee on it is marked unavailable. Pruning must never block a
--     deactivation, so it uses the same app.skip_unavailability_check
--     transaction-local flag auto_assign_task_slots uses (and restores the
--     previous value afterwards).
--   * trigger_validate_event_tasks_assignments_tenant_scope (BEFORE INSERT OR
--     UPDATE) rejects ANY update to an assignment whose task is soft-deleted.
--     Such a row is therefore never UPDATEd here: if pruning would leave it
--     empty it is DELETEd (the validate trigger does not fire on DELETE);
--     otherwise it is left as-is. A stale id inside a soft-deleted task's
--     assignment is invisible and harmless (the task is not shown anywhere), and
--     skipping it is what keeps a deactivation from ever failing because of it.
--
-- Not covered (by design): reactivating a member does NOT restore their
-- assignments — they must be re-assigned by hand.


-- ==============================================================
-- SECTION 1: one-time cleanup of existing stale data. Idempotent: it only
-- touches rows that still contain a stale or repeated member id, so a second run
-- changes nothing.
--
--   1. clear current answers of deleted members (history rows are kept)
--   2. rewrite assignee.member_ids to the distinct ids of ACTIVE members of the
--      row's tenant, in their original order; group_ids are kept (duplicates
--      removed); other keys are preserved; healthy rows are not touched
--   3. delete rows that end up with no members and no groups, then bump
--      events.version / updated_at once per affected event (including events
--      whose assignment was deleted)
-- ==============================================================

DO $$
DECLARE
  v_prev_skip TEXT := current_setting('app.skip_unavailability_check', true);
BEGIN
  PERFORM set_config('app.skip_unavailability_check', 'true', true);

  -- 1. current answers of deleted members
  UPDATE event_task_assignment_responses r
  SET is_current = false, cleared_at = now(), cleared_reason = 'REMOVED_FROM_ASSIGNMENT'
  FROM members m
  WHERE r.is_current
    AND m.id = r.member_id
    AND m.deleted_at IS NOT NULL;

  -- 2 + 3. prune, delete the emptied, bump once per event
  CREATE TEMP TABLE _fp234_touched (
    assignment_id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    event_id UUID NOT NULL
  ) ON COMMIT DROP;

  CREATE TEMP TABLE _fp234_pruned ON COMMIT DROP AS
  SELECT a.id AS assignment_id, a.tenant_id, a.event_id,
         t.deleted_at IS NULL AS task_active,
         COALESCE(k.kept, '[]'::jsonb) AS kept_members,
         COALESCE(
           (SELECT jsonb_agg(g.gid ORDER BY g.first_ord)
              FROM (SELECT x.gid, min(x.ord) AS first_ord
                      FROM jsonb_array_elements_text(COALESCE(a.assignee->'group_ids', '[]'::jsonb)) WITH ORDINALITY x(gid, ord)
                     GROUP BY x.gid) g),
           '[]'::jsonb) AS kept_groups,
         a.assignee AS old_assignee
  FROM event_tasks_assignments a
  JOIN tasks t ON t.id = a.task_id
  CROSS JOIN LATERAL (
    SELECT jsonb_agg(d.mid ORDER BY d.first_ord) AS kept
    FROM (
      SELECT x.mid, min(x.ord) AS first_ord
      FROM jsonb_array_elements_text(COALESCE(a.assignee->'member_ids', '[]'::jsonb)) WITH ORDINALITY x(mid, ord)
      JOIN members m ON m.id = x.mid::uuid AND m.tenant_id = a.tenant_id AND m.deleted_at IS NULL
      GROUP BY x.mid
    ) d
  ) k
  WHERE a.assignee ? 'member_ids'
    AND a.assignee->'member_ids' IS DISTINCT FROM COALESCE(k.kept, '[]'::jsonb);

  -- rows that can be rewritten (task still active)
  WITH upd AS (
    UPDATE event_tasks_assignments a
    SET assignee = a.assignee
                   || jsonb_build_object('member_ids', p.kept_members)
                   || CASE WHEN a.assignee ? 'group_ids'
                           THEN jsonb_build_object('group_ids', p.kept_groups) ELSE '{}'::jsonb END,
        updated_at = now()
    FROM _fp234_pruned p
    WHERE a.id = p.assignment_id
      AND p.task_active
      AND (jsonb_array_length(p.kept_members) > 0 OR jsonb_array_length(p.kept_groups) > 0)
    RETURNING a.id, a.tenant_id, a.event_id
  )
  INSERT INTO _fp234_touched SELECT * FROM upd;

  -- rows left empty (any task state): delete. History rows keep existing
  -- (assignment_id -> NULL); their current answers were cleared in step 1 or are
  -- cleared here.
  UPDATE event_task_assignment_responses r
  SET is_current = false, cleared_at = now(), cleared_reason = 'ASSIGNMENT_DELETED'
  FROM _fp234_pruned p
  WHERE r.assignment_id = p.assignment_id AND r.is_current
    AND jsonb_array_length(p.kept_members) = 0 AND jsonb_array_length(p.kept_groups) = 0;

  WITH del AS (
    DELETE FROM event_tasks_assignments a
    USING _fp234_pruned p
    WHERE a.id = p.assignment_id
      AND jsonb_array_length(p.kept_members) = 0 AND jsonb_array_length(p.kept_groups) = 0
    RETURNING a.id, a.tenant_id, a.event_id
  )
  INSERT INTO _fp234_touched SELECT * FROM del;

  -- one bump per affected event
  UPDATE events e
  SET version = e.version + 1, updated_at = now()
  FROM (SELECT DISTINCT tenant_id, event_id FROM _fp234_touched) t
  WHERE e.id = t.event_id AND e.tenant_id = t.tenant_id;

  PERFORM set_config('app.skip_unavailability_check', COALESCE(v_prev_skip, ''), true);
END
$$;


-- ==============================================================
-- SECTION 2: prune_deleted_member_from_assignments() — fires once when a member
-- goes from active to deleted/deactivated. Runs AFTER the row update, so the
-- existing BEFORE guard triggers (assigned leader / owns groups / owns events)
-- still run first and can still reject the deactivation; if one does, this never
-- runs and nothing here is applied. Everything below is in the same transaction
-- as the deactivation itself and scoped to NEW.id / NEW.tenant_id.
--
--   1. clear the member's current responses (REMOVED_FROM_ASSIGNMENT; history kept)
--   2. remove the id from every assignee.member_ids (duplicates removed too)
--   3. delete assignments left with no members and no groups (history rows stay,
--      assignment_id -> NULL)
--   4. bump events.version / updated_at ONCE per affected event, including events
--      whose assignment was deleted (event ids are collected before deleting)
--
-- SECURITY DEFINER with search_path set; closed to PUBLIC/anon/authenticated and
-- granted to service_role only (FP-228 convention — trigger functions don't need
-- EXECUTE at fire time).
-- ==============================================================

CREATE OR REPLACE FUNCTION public.prune_deleted_member_from_assignments()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_prev_skip TEXT := current_setting('app.skip_unavailability_check', true);
  v_event_ids UUID[];
  r RECORD;
  v_members JSONB;
  v_groups JSONB;
BEGIN
  IF NOT (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) THEN
    RETURN NEW;
  END IF;

  -- Removing this member must never be blocked because ANOTHER assignee on the
  -- same task is marked unavailable (same flag auto_assign_task_slots uses).
  PERFORM set_config('app.skip_unavailability_check', 'true', true);

  -- 1. their current answers
  UPDATE event_task_assignment_responses
  SET is_current = false, cleared_at = now(), cleared_reason = 'REMOVED_FROM_ASSIGNMENT'
  WHERE tenant_id = NEW.tenant_id AND member_id = NEW.id AND is_current;

  v_event_ids := ARRAY[]::UUID[];

  -- 2 + 3. every assignment of this tenant that lists them
  FOR r IN
    SELECT a.id, a.event_id, a.assignee, t.deleted_at IS NULL AS task_active
    FROM event_tasks_assignments a
    JOIN tasks t ON t.id = a.task_id
    WHERE a.tenant_id = NEW.tenant_id
      AND a.assignee->'member_ids' @> to_jsonb(NEW.id::text)
    FOR UPDATE OF a
  LOOP
    SELECT COALESCE(jsonb_agg(d.mid ORDER BY d.first_ord), '[]'::jsonb) INTO v_members
    FROM (
      SELECT x.mid, min(x.ord) AS first_ord
      FROM jsonb_array_elements_text(r.assignee->'member_ids') WITH ORDINALITY x(mid, ord)
      WHERE x.mid <> NEW.id::text
      GROUP BY x.mid
    ) d;

    SELECT COALESCE(jsonb_agg(g.gid ORDER BY g.first_ord), '[]'::jsonb) INTO v_groups
    FROM (
      SELECT x.gid, min(x.ord) AS first_ord
      FROM jsonb_array_elements_text(COALESCE(r.assignee->'group_ids', '[]'::jsonb)) WITH ORDINALITY x(gid, ord)
      GROUP BY x.gid
    ) g;

    IF jsonb_array_length(v_members) = 0 AND jsonb_array_length(v_groups) = 0 THEN
      -- left empty: delete (also the only safe option for a soft-deleted task, see header)
      UPDATE event_task_assignment_responses
      SET is_current = false, cleared_at = now(), cleared_reason = 'ASSIGNMENT_DELETED'
      WHERE assignment_id = r.id AND is_current;

      DELETE FROM event_tasks_assignments WHERE id = r.id;
      v_event_ids := array_append(v_event_ids, r.event_id);
    ELSIF r.task_active THEN
      UPDATE event_tasks_assignments
      SET assignee = r.assignee
                     || jsonb_build_object('member_ids', v_members)
                     || CASE WHEN r.assignee ? 'group_ids'
                             THEN jsonb_build_object('group_ids', v_groups) ELSE '{}'::jsonb END,
          updated_at = now()
      WHERE id = r.id;
      v_event_ids := array_append(v_event_ids, r.event_id);
    END IF;
    -- else: soft-deleted task whose assignment is not empty — left as-is (header).
  END LOOP;

  -- 4. one bump per affected event
  UPDATE events e
  SET version = e.version + 1, updated_at = now()
  WHERE e.tenant_id = NEW.tenant_id
    AND e.id IN (SELECT DISTINCT unnest(v_event_ids));

  PERFORM set_config('app.skip_unavailability_check', COALESCE(v_prev_skip, ''), true);
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.prune_deleted_member_from_assignments() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_deleted_member_from_assignments() TO service_role;

DROP TRIGGER IF EXISTS trigger_prune_deleted_member_from_assignments ON members;
CREATE TRIGGER trigger_prune_deleted_member_from_assignments
AFTER UPDATE OF deleted_at ON members
FOR EACH ROW
WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
EXECUTE FUNCTION prune_deleted_member_from_assignments();
