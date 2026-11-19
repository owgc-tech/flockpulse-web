DIP-FP-180-adj-2
Story Summary
Widens FP-180's "upcoming events" scope for both auto-assign screens from SCHEDULED/ACTIVE only to DRAFT/SCHEDULED/ACTIVE. Draft events should now also be included as candidates for the round-robin fill and appear in each screen's slot list, alongside events that have already been scheduled or are currently active.
Repo Target
Web (Next.js), owgc-tech/flockpulse-web.
Grounding Check

DRAFT is a legitimate return value of get_event_effective_status() (confirmed by reading 20260629000009_derive_event_state.sql directly) — this is purely widening an existing allowlist, not inventing a new status value.
No conflict with Section 4 invariants — still only affects which events' event_tasks_assignments rows are touched, not attendance/formation logic.
Checked for collateral scope before touching anything: eventTaskAssignment.service.ts's listMyTaskAssignments ("My Tasks", FP-164) also filters to SCHEDULED/ACTIVE only, but that's a separate feature with its own deliberate scope (FP-164's own "allowlist, not denylist" comment) — not touched by this DIP. Only FP-180's own two files (plus two comment-only route files) are in scope.
CANCELLED/COMPLETED/LOCKED remain excluded — unchanged.
Grep-confirmed the full blast radius of the stale SCHEDULED/ACTIVE-only wording before drafting: it appears in exactly four places — the RPC's WHERE clause, listSlotsForTaskUpcoming's filter + doc comment, and one comment line each in the two /slots/route.ts files. TaskAutoAssignPanel.tsx and both page.tsx files contain no such reference — confirmed via grep, not assumed.

Implementation Plan

Migration: CREATE OR REPLACE auto_assign_task_slots, identical to the adj-1 version except the WHERE clause's status list becomes ('DRAFT', 'SCHEDULED', 'ACTIVE').
Repository (eventTaskAssignment.repository.ts): in listSlotsForTaskUpcoming, change the upcomingEventIds filter from r.effective_status === 'SCHEDULED' || r.effective_status === 'ACTIVE' to also accept 'DRAFT'; update the function's doc comment accordingly.
Route comments only (no logic change — these routes just call the service, which now returns the wider set automatically): update the (SCHEDULED/ACTIVE) wording in the doc comments of app/api/tasks/auto-assign/prayer-leader/slots/route.ts and app/api/tasks/auto-assign/food-assignment/slots/route.ts to (DRAFT/SCHEDULED/ACTIVE).

Files to Create/Modify

supabase/migrations/20260724000057_auto_assign_include_draft_events.sql (new)
src/features/tasks/eventTaskAssignment.repository.ts (modify — listSlotsForTaskUpcoming's filter + comment only)
app/api/tasks/auto-assign/prayer-leader/slots/route.ts (modify — comment only)
app/api/tasks/auto-assign/food-assignment/slots/route.ts (modify — comment only)

Migration Files
sql-- DIP-FP-180-adj-2: widen "upcoming events" for both auto-assign screens from
-- SCHEDULED/ACTIVE to DRAFT/SCHEDULED/ACTIVE, per explicit user direction.
-- CANCELLED/COMPLETED/LOCKED remain excluded. Same signature/return shape as
-- the adj-1 version — only the status allowlist in the WHERE clause changes.

CREATE OR REPLACE FUNCTION public.auto_assign_task_slots(
    p_tenant_id UUID,
    p_task_id UUID,
    p_roster JSONB,
    p_actor_member_id UUID
)
RETURNS TABLE (
    id UUID, event_id UUID, task_id UUID, assignee JSONB,
    created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
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
  v_touched_ids UUID[] := ARRAY[]::UUID[];
  v_row_id UUID;
  i INT;
BEGIN
  SELECT array_agg(e.id ORDER BY e.start_datetime ASC, e.id ASC)
  INTO v_event_ids
  FROM events e
  WHERE e.tenant_id = p_tenant_id
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
    RETURNING event_tasks_assignments.id INTO v_row_id;

    v_touched_ids := array_append(v_touched_ids, v_row_id);
  END LOOP;

  RETURN QUERY
  SELECT eta.id, eta.event_id, eta.task_id, eta.assignee, eta.created_at, eta.updated_at
  FROM event_tasks_assignments eta
  WHERE eta.id = ANY(v_touched_ids)
  ORDER BY eta.updated_at DESC;
END;
$$;

-- No pre-flight duplicate check needed this time — the unique index from
-- adj-1 already exists and this migration doesn't touch it.
-- No explicit GRANT needed — same as prior migrations in this file set.
Branch Name
feature/FP-180-adj-2-include-draft-events
Commit Message
FP-180-adj-2: include DRAFT events in Prayer Leader/Food Assignment auto-assign scope
Pull Request Description

"Both Draft and Scheduled events should be subject to auto-assign" → auto_assign_task_slots's status allowlist widened to DRAFT/SCHEDULED/ACTIVE; listSlotsForTaskUpcoming widened identically so the slot list and the RPC always agree on scope.
Confirmed out of scope, not touched: FP-164's "My Tasks" feature, which has its own separate, deliberately narrower SCHEDULED/ACTIVE-only rule.
Include the git diff dev [branch] -- src/features/tasks/eventTaskAssignment.service.ts zero-output proof that the unrelated "My Tasks" file was not touched.

Jira Linkage

PDEEpicID: FP-11
PDEStoryID: FP-180

Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-180-adj-2.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against dev and stop. Do not merge — the user will check out the branch locally, test it, and merge manually.
Include full diffs for every file in the completion report, no elisions.
