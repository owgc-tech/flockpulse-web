### Not covered — deliberately excluded
- Mobile Commit/Refuse pills and Tasks badge decrement: slice 2, its own DIP, after this one is merged and deployed.
- Needs Attention and Recently Modified indicators and the last-viewed tracking table: FP-222, slice 3.
- Notifications of any kind: dropped (see FP-221). Real push is FP-227.
- Any screen showing refusal counts: where to show it is not decided. This DIP only guarantees the data supports it.

### Story Summary
Slice 1 of 3 for FP-221, on the web repo. Adds per-person Commit/Refuse responses to task assignments, stored as permanent append-only history (Joseph wants to track how many times each person has refused). Adds the endpoint to submit or change a response, adds the caller's current response to GET /api/event-tasks-assignments/mine, makes every assignment write bump events.version and clear responses of people no longer assigned (atomically, history kept), and shows outstanding refusals to the event owner and Admins on the web event detail page.

### Repo Target
Web (Next.js + Supabase migrations). All shared backend/API work lives in this repo.

### Grounding Check
Verified live against owgc-tech/flockpulse-web dev this session, not assumed from the spec:
- event_tasks_assignments (20260719000051): id, tenant_id, event_id (ON DELETE CASCADE), task_id, assignee JSONB ({group_ids, member_ids}), created_at, updated_at. One row covers many people and groups, so it cannot hold per-person state. No audit columns.
- Assignee resolution: listMyTaskAssignments (eventTaskAssignment.service.ts) resolves "member_ids contains me OR any group_ids I belong to", where group membership = rows in assignments with assignment_type = 'GROUP' and deleted_at IS NULL. It only returns events whose effective status is SCHEDULED/ACTIVE, so a task leaves the Tasks tab on its own once the event is over.
- events.version is a plain counter, not a concurrency token: update_event_with_audit increments it, no function takes an expected version, no client compares it. Bumping it from assignment writes cannot cause false conflicts.
- Assignment write paths found: createTaskAssignment, updateTaskAssignment, deleteTaskAssignment (service) and the auto_assign_task_slots RPC (latest definition: 20260811000070_member_unavailability_hard_block.sql). Confirm there are no others (search every write to event_tasks_assignments, including other RPCs) and cover all of them.
- Standing patterns to mirror: validate_event_tasks_assignments_tenant_scope (tenant trigger, SECURITY DEFINER, search_path set); single tenant RLS policy via get_tenant_id().
- The web event page already computes canManage = isAdminTier(role) || event.owner_member_id === memberId (app/admin/(shell)/events/[id]/page.tsx). Reuse it for who sees refusals.
- Error codes: check Engineering Spec section 6 before introducing any code. FORBIDDEN_SCOPE for not-an-assignee. For event-not-open use the spec's canonical code if one fits; if none does, say so in the PR rather than inventing one.
- No conflict with the invariant domain rules: RSVP/self-report/attendance untouched; tenant id derived server-side from the JWT, never from the request body.

### Implementation Plan
1. Migration 20261003000073_task_assignment_responses.sql (SQL below).
2. Migration 20261003000074_task_assignment_response_functions.sql, all SECURITY DEFINER with search_path set:
   a. resolve_assignee_member_ids(p_tenant_id, p_assignee JSONB) returns the member ids an assignee resolves to. Must mirror listMyTaskAssignments exactly: direct member_ids UNION members of the listed groups via assignments (assignment_type = 'GROUP', deleted_at IS NULL, same tenant). Add a code comment in both places pointing at each other, since the rule now exists in TypeScript and SQL.
   b. submit_task_assignment_response(p_tenant_id, p_assignment_id, p_member_id, p_status). In one transaction: assignment exists in tenant; its event's effective status (get_event_effective_status) is SCHEDULED or ACTIVE; member is active in the tenant; member is in resolve_assignee_member_ids for that assignment. If a current row already has the same status, return it unchanged (idempotent). Otherwise mark the existing current row is_current = false, cleared_at = now(), cleared_reason = 'SUPERSEDED', then insert the new current row (task_id and event_id copied from the assignment). Must NOT touch events.version or updated_at: a refusal is not a modification. Each failure raises a distinguishable error the service maps to a canonical code.
   c. Atomic assignment writers replacing the separate client calls, each doing the original write plus the following in one transaction:
      - create: insert, bump events.version and updated_at by 1.
      - update: patch assignee; mark current responses of every member who no longer resolves under the new assignee as is_current = false, cleared_reason = 'REMOVED_FROM_ASSIGNMENT'; bump version.
      - delete: mark all current responses for the assignment cleared with 'ASSIGNMENT_DELETED', then delete the assignment (history rows keep existing, assignment_id becomes NULL via the FK); bump version.
      - auto_assign_task_slots: CREATE OR REPLACE the latest definition, preserving its current behavior exactly, and add the same bump and clearing for each event/assignment it changes (bump once per event touched). Read the latest definition first and diff your replacement against it.
   d. Hard rule: no function and no TypeScript path ever DELETEs from event_task_assignment_responses.
3. Repository/service/types (src/features/tasks/): route createTaskAssignment, updateTaskAssignment, deleteTaskAssignment through the atomic functions without changing their exported signatures; add submitTaskAssignmentResponse; add my_response ('COMMITTED' | 'REFUSED' | null, current row only) to MyTaskAssignmentRow and fetch it in listMyTaskAssignments with ONE extra query, not one per row; add listOutstandingRefusalsForEvent(tenantId, eventId) returning current REFUSED rows whose member still resolves as an assignee, with member names.
4. Route: POST /api/event-tasks-assignments/[id]/response, body { status: 'COMMITTED' | 'REFUSED' }. Any authenticated member (withAuth); tenant and member come from the JWT context only. Returns { data: { assignment_id, status, responded_at } }.
5. Web event detail page: pass listOutstandingRefusalsForEvent results to EventDetail.tsx only when canManage is true, and show them in the Tasks card next to the affected task as a plain "Refused: Name" line using the card's existing styles. Everyone else sees nothing new.
6. Validate both migrations locally (supabase start, then supabase db reset). Never apply to the remote database; Joseph applies after reviewing.

Migration 1 SQL:
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

  Tenant trigger (BEFORE INSERT OR UPDATE, SECURITY DEFINER, search_path = public, pg_catalog), same shape as validate_event_tasks_assignments_tenant_scope: when assignment_id / event_id are not NULL they must belong to NEW.tenant_id; task_id and member_id must belong to NEW.tenant_id. Do NOT require deleted_at IS NULL on task or member here: history rows must stay valid after a task or member is later deactivated. The submit function checks the member is active separately.

  ALTER TABLE event_task_assignment_responses ENABLE ROW LEVEL SECURITY;
  GRANT SELECT ON event_task_assignment_responses TO authenticated;
  DROP POLICY IF EXISTS "event_task_assignment_responses_select" ON event_task_assignment_responses;
  CREATE POLICY "event_task_assignment_responses_select" ON event_task_assignment_responses
      FOR SELECT USING (tenant_id = get_tenant_id());
  (Writes happen only through the SECURITY DEFINER functions and the service client, so no INSERT/UPDATE/DELETE grant to authenticated.)

Migration 2 helper SQL:
  CREATE OR REPLACE FUNCTION public.resolve_assignee_member_ids(p_tenant_id UUID, p_assignee JSONB)
  RETURNS TABLE (member_id UUID) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
    SELECT m.member_id FROM (
      SELECT (jsonb_array_elements_text(COALESCE(p_assignee->'member_ids', '[]'::jsonb)))::uuid AS member_id
      UNION
      SELECT a.member_id FROM assignments a
      WHERE a.tenant_id = p_tenant_id AND a.assignment_type = 'GROUP' AND a.deleted_at IS NULL
        AND a.group_id IN (SELECT (jsonb_array_elements_text(COALESCE(p_assignee->'group_ids', '[]'::jsonb)))::uuid)
    ) m
  $$;

### Files to Create/Modify
- supabase/migrations/20261003000073_task_assignment_responses.sql (new)
- supabase/migrations/20261003000074_task_assignment_response_functions.sql (new)
- src/features/tasks/eventTaskAssignment.repository.ts (modify)
- src/features/tasks/eventTaskAssignment.service.ts (modify)
- src/features/tasks/eventTaskAssignment.types.ts (modify)
- app/api/event-tasks-assignments/[id]/response/route.ts (new)
- app/admin/(shell)/events/[id]/page.tsx (modify)
- app/admin/(shell)/events/[id]/EventDetail.tsx (modify)

### Branch Name
feature/FP-221-web-task-assignment-responses

### Commit Message
FP-221-web: per-person task Commit/Refuse responses with permanent history

### Pull Request Description
Maps to FP-221's web-foundation acceptance criteria. In the PR body, show evidence for each, run against local or dev data:
1. As an assignee, Refuse then Commit: history has 2 rows for that assignment and member, the first with is_current = false and cleared_reason = 'SUPERSEDED', the second current.
2. As a non-assignee: rejected with FORBIDDEN_SCOPE. Event ended, draft or cancelled: rejected.
3. Owner replaces a refusing person via the update path: their refusal row remains but is cleared with REMOVED_FROM_ASSIGNMENT; events.version increased by exactly 1.
4. Delete the assignment: response rows remain, assignment_id is NULL, cleared_reason = 'ASSIGNMENT_DELETED'.
5. A Commit or Refuse alone changes neither events.version nor updated_at.
6. Auto-assign path: replacing someone bumps version and clears their response; its existing behavior is otherwise unchanged (include a before/after of one run).
7. Web event page: the owner and an Admin see outstanding refusals; a non-owner Leader does not.
8. Cross-tenant attempt on the new table is rejected by the trigger.
9. Paste the SQL that counts REFUSED rows per member over the full history, and its result, as proof the history supports the count Joseph wants.
List every write path to event_tasks_assignments you found, and which function now covers each.

### Jira Linkage
- PDEEpicID: FP-31
- PDEStoryID: FP-221

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-221-web-slice-1.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against dev and stop. Do not merge, and do not apply any migration to the remote database. The user applies the migrations manually after review, then merges.

Include full diffs for every file in your completion report per Section 5, rule 12, not a summary.
