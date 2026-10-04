-- FP-221-web: per-person Commit/Refuse responses to task assignments.
--
-- event_tasks_assignments holds one row per (event, task) covering many people
-- and groups via its assignee JSONB, so it cannot hold per-person state. This
-- table is the per-person, append-only response history: a response is never
-- edited or deleted. Changing your answer, being removed from the assignment,
-- or the assignment being deleted all mark the old row is_current = false with
-- a cleared_reason, and (for a changed answer) insert a new current row. That
-- is what lets "how many times has each person refused" be answered from the
-- full history (SELECT member_id, count(*) ... WHERE status = 'REFUSED').
--
-- No code path ever DELETEs from this table. assignment_id / event_id use
-- ON DELETE SET NULL (not CASCADE) so history survives an assignment or event
-- being removed.

CREATE TABLE IF NOT EXISTS event_task_assignment_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    assignment_id UUID REFERENCES event_tasks_assignments(id) ON DELETE SET NULL,
    event_id UUID REFERENCES events(id) ON DELETE SET NULL,
    task_id UUID NOT NULL REFERENCES tasks(id),
    member_id UUID NOT NULL REFERENCES members(id),
    status TEXT NOT NULL CHECK (status IN ('COMMITTED', 'REFUSED')),
    responded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_current BOOLEAN NOT NULL DEFAULT true,
    cleared_at TIMESTAMPTZ,
    cleared_reason TEXT CHECK (cleared_reason IN ('SUPERSEDED', 'REMOVED_FROM_ASSIGNMENT', 'ASSIGNMENT_DELETED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT etar_cleared_consistency CHECK (
        (is_current AND cleared_at IS NULL AND cleared_reason IS NULL)
        OR (NOT is_current AND cleared_at IS NOT NULL AND cleared_reason IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_etar_one_current_per_member
    ON event_task_assignment_responses(assignment_id, member_id) WHERE is_current;
CREATE INDEX IF NOT EXISTS idx_etar_member_status
    ON event_task_assignment_responses(tenant_id, member_id, status);
CREATE INDEX IF NOT EXISTS idx_etar_assignment_current
    ON event_task_assignment_responses(assignment_id) WHERE is_current;


-- ==============================================================
-- Cross-tenant safety trigger — same shape as
-- validate_event_tasks_assignments_tenant_scope. assignment_id / event_id are
-- nullable (history outlives the assignment), so they are only checked when
-- present. task_id and member_id deliberately do NOT require deleted_at IS
-- NULL: history rows must stay valid after a task or member is later
-- deactivated (submit_task_assignment_response checks the member is active
-- separately, at submission time).
-- ==============================================================

CREATE OR REPLACE FUNCTION public.validate_event_task_assignment_responses_tenant_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.assignment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM event_tasks_assignments
    WHERE id = NEW.assignment_id AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'event_task_assignment_responses.assignment_id % is invalid or belongs to a different tenant', NEW.assignment_id;
  END IF;

  IF NEW.event_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM events
    WHERE id = NEW.event_id AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'event_task_assignment_responses.event_id % is invalid or belongs to a different tenant', NEW.event_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM tasks
    WHERE id = NEW.task_id AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'event_task_assignment_responses.task_id % is invalid or belongs to a different tenant', NEW.task_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM members
    WHERE id = NEW.member_id AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'event_task_assignment_responses.member_id % is invalid or belongs to a different tenant', NEW.member_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_validate_event_task_assignment_responses_tenant_scope ON event_task_assignment_responses;
CREATE TRIGGER trigger_validate_event_task_assignment_responses_tenant_scope
BEFORE INSERT OR UPDATE ON event_task_assignment_responses
FOR EACH ROW EXECUTE FUNCTION validate_event_task_assignment_responses_tenant_scope();


-- ==============================================================
-- RLS. Writes happen only through the SECURITY DEFINER functions in
-- 20261003000074 and the service client, so there is deliberately no
-- INSERT/UPDATE/DELETE grant to authenticated. anon gets nothing.
-- ==============================================================

ALTER TABLE event_task_assignment_responses ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON event_task_assignment_responses TO authenticated;

DROP POLICY IF EXISTS "event_task_assignment_responses_select" ON event_task_assignment_responses;
CREATE POLICY "event_task_assignment_responses_select" ON event_task_assignment_responses
    FOR SELECT USING (tenant_id = get_tenant_id());
