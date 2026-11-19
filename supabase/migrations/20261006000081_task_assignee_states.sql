-- DIP-FP-242-web: for every task assignment on one event, the people it resolves
-- to and each person's CURRENT response (COMMITTED / REFUSED / PENDING = no current
-- response). Read-only. One call per event, returned as a single JSONB array so a
-- large group (Everyone) never hits PostgREST's row limit.
--
-- Resolution matches resolve_assignee_member_ids() (20261003000074): direct
-- member_ids UNION members of the listed groups (assignments, assignment_type
-- 'GROUP', deleted_at IS NULL, same tenant) — plus two filters it does not apply:
-- the member must belong to p_tenant_id and must not be removed (members.deleted_at).
-- A person reached both directly and through a group is reported as direct
-- (via_group_id NULL); a person in several listed groups is reported once, under
-- the first group in assignee.group_ids order.
--
-- KEEP IN SYNC with resolve_assignee_member_ids(), listRefusedTaskNamesByEvent()
-- (src/features/tasks/refusedTasks.ts) and listMyTaskAssignments(). A test asserts
-- this function and resolve_assignee_member_ids() never disagree.

CREATE OR REPLACE FUNCTION public.list_event_task_assignee_states(p_tenant_id UUID, p_event_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  WITH a AS (
    SELECT eta.id AS assignment_id, eta.assignee
    FROM event_tasks_assignments eta
    WHERE eta.tenant_id = p_tenant_id AND eta.event_id = p_event_id
  ),
  candidates AS (
    SELECT a.assignment_id, (d.v)::uuid AS member_id, NULL::uuid AS via_group_id, 0::bigint AS pos
    FROM a CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(a.assignee->'member_ids', '[]'::jsonb)) AS d(v)
    UNION ALL
    SELECT a.assignment_id, asg.member_id, (g.v)::uuid, g.ord
    FROM a
    CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(a.assignee->'group_ids', '[]'::jsonb)) WITH ORDINALITY AS g(v, ord)
    JOIN assignments asg
      ON asg.tenant_id = p_tenant_id AND asg.assignment_type = 'GROUP' AND asg.deleted_at IS NULL
     AND asg.group_id = (g.v)::uuid
  ),
  resolved AS (
    SELECT DISTINCT ON (c.assignment_id, c.member_id) c.assignment_id, c.member_id, c.via_group_id
    FROM candidates c
    ORDER BY c.assignment_id, c.member_id, c.pos
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'assignment_id', r.assignment_id,
           'member_id', r.member_id,
           'name', btrim(concat_ws(' ', m.first_name, m.last_name)),
           'state', COALESCE(resp.status, 'PENDING'),
           'via_group_id', r.via_group_id
         ) ORDER BY r.assignment_id, m.last_name, m.first_name, r.member_id), '[]'::jsonb)
  FROM resolved r
  JOIN members m ON m.id = r.member_id AND m.tenant_id = p_tenant_id AND m.deleted_at IS NULL
  LEFT JOIN event_task_assignment_responses resp
    ON resp.tenant_id = p_tenant_id AND resp.assignment_id = r.assignment_id
   AND resp.member_id = r.member_id AND resp.is_current
$$;

REVOKE EXECUTE ON FUNCTION public.list_event_task_assignee_states(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_event_task_assignee_states(UUID, UUID) TO service_role;
