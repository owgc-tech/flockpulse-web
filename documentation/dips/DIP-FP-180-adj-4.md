DIP-FP-180-adj-4
Story Summary
Adds an event-type filter to both the Prayer Leader and Food Assignment auto-assign screens: a new checkbox section, laid out 3–4 across and wrapping to additional rows as needed, above each screen's slot list. All event types start unchecked, meaning the slot list is empty until the organizer actively checks at least one — as each type is checked, that type's events appear in the list below. Only checked types are eligible for both the displayed slot list and what the round-robin actually touches when "Run auto-assign" fires. Selection is ephemeral per visit, same as the roster — nothing is persisted between sessions.
Repo Target
Web (Next.js), owgc-tech/flockpulse-web.
Grounding Check

events.event_type_id confirmed NOT NULL with an FK to event_types(id) (20260629000016) — every event has exactly one type, so this is a clean event_type_id = ANY(p_event_type_ids) filter, no null-handling needed.
Event types are fetched via the existing listEventTypes(tenantId), which already defaults to active-only — same convention as listMembers/listGroups.
Empty-by-default requires the GET slots path to treat an empty selection as "return no slots," not an error — this is now the actual default state on first render, not just an edge case, so it must render cleanly (empty slot list, no error banner) rather than fail.
The POST run endpoint, by contrast, still requires a non-empty selection and returns VALIDATION_ERROR otherwise — mirroring the same run-time-only validation posture already established for an empty roster. "Run auto-assign" stays disabled until the organizer has both a roster and at least one checked event type.
RPC signature is changing (new p_event_type_ids UUID[] parameter) — an arity change, so CREATE OR REPLACE alone would create a second overloaded function rather than replacing the existing one. Explicit DROP FUNCTION IF EXISTS with the current 4-argument signature is required first, per the standing DIP checklist rule for RPC signature changes.
Cross-tenant safety: validateEventTypeIds mirrors validateAssignee's existing precedent exactly — tenant-scoped, active (deleted_at IS NULL) check before any ID is trusted.
No new tenant-scoped table, so no new trigger required.
Canonical error code: reusing VALIDATION_ERROR, consistent with the rest of this feature area.

Implementation Plan

Migration: DROP FUNCTION IF EXISTS public.auto_assign_task_slots(UUID, UUID, JSONB, UUID); then recreate with a new p_event_type_ids UUID[] parameter. Body gains an early-return guard for a null/empty array, and the event-selection query gains AND e.event_type_id = ANY(p_event_type_ids). Everything else (upsert logic, round-robin, RETURNS SETOF event_tasks_assignments) is unchanged from adj-3.
Repository (eventTaskAssignment.repository.ts):

listSlotsForTaskUpcoming(tenantId, taskId, eventTypeIds): new third parameter; short-circuits to [] if eventTypeIds.length === 0 (no query at all); the existing events query gains .in('event_type_id', eventTypeIds).
runAutoAssignTaskSlots(tenantId, taskId, roster, actorMemberId, eventTypeIds): new fifth parameter, passed through as p_event_type_ids to the RPC call.


Service (autoAssign.service.ts):

New validateEventTypeIds(eventTypeIds, tenantId): non-empty check (VALIDATION_ERROR), then tenant-scoped-and-active check against event_types (mirrors validateAssignee).
getPrayerLeaderAutoAssignData/getFoodAssignmentAutoAssignData: new eventTypeIds parameter, passed straight through to the repository — no validation here (graceful-empty posture; this is the default state, not an error).
runPrayerLeaderAutoAssign/runFoodAssignmentAutoAssign: new eventTypeIds parameter; calls validateEventTypeIds alongside the existing roster validation before running.


API routes (all four, Leader-tier-or-above unchanged):

Both /slots GET routes: read event_type_ids from the query string (comma-separated), split into an array (empty/missing → []), pass through.
Both POST run routes: read event_type_ids from the request body alongside roster, validate it's an array (MISSING_FIELD if not), pass through; catch VALIDATION_ERROR same as the existing roster check.


Pages (both): fetch listEventTypes(tenantId) alongside the existing listMembers/listGroups calls, pass eventTypes={eventTypes ?? []} down to the panel.
TaskAutoAssignPanel.tsx:

New prop eventTypes: EventTypeOption[].
New state const [selectedEventTypeIds, setSelectedEventTypeIds] = useState<string[]>([]); — plain empty default, nothing pre-resolved.
New "Event types" card, inserted between the existing Roster card and the {taskLabel} slots card (directly above the list of events, per your instruction) — a grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-2 of checkboxes, one per active event type, wrapping automatically as more types are added. Below the grid, when nothing is checked, the slot list shows a plain "Check an event type above to see its open slots" message rather than the generic "No open slots" text, so the empty default doesn't read as a bug.
The slots-fetching useEffect gains selectedEventTypeIds as a dependency and appends ?event_type_ids=${selectedEventTypeIds.join(',')} to the request — every checkbox toggle re-fetches the slot list scoped to the new selection, so events appear as their type is checked.
handleRun guard extended to also require selectedEventTypeIds.length > 0; the POST body gains event_type_ids: selectedEventTypeIds alongside roster.
"Run auto-assign" button disabled condition extended: running || roster.length === 0 || selectedEventTypeIds.length === 0.



Files to Create/Modify

supabase/migrations/20260725000059_auto_assign_event_type_filter.sql (new)
src/features/tasks/eventTaskAssignment.repository.ts (modify — two function signatures only)
src/features/tasks/autoAssign.service.ts (modify — new validator, four function signatures)
app/api/tasks/auto-assign/prayer-leader/slots/route.ts (modify)
app/api/tasks/auto-assign/food-assignment/slots/route.ts (modify)
app/api/tasks/auto-assign/prayer-leader/route.ts (modify)
app/api/tasks/auto-assign/food-assignment/route.ts (modify)
app/admin/(shell)/tasks/prayer-leader-auto-assign/page.tsx (modify)
app/admin/(shell)/tasks/food-assignment-auto-assign/page.tsx (modify)
app/admin/(shell)/tasks/_shared/TaskAutoAssignPanel.tsx (modify — new UI section + state)

Migration Files
sql-- DIP-FP-180-adj-4: adds event-type scoping to both auto-assign screens.
-- Signature change (new p_event_type_ids UUID[] param), so DROP FUNCTION
-- first — CREATE OR REPLACE alone would create a second overload rather
-- than replacing the existing 4-arg function, per the standing DIP
-- checklist rule for RPC signature changes.

DROP FUNCTION IF EXISTS public.auto_assign_task_slots(UUID, UUID, JSONB, UUID);

CREATE FUNCTION public.auto_assign_task_slots(
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
  IF p_event_type_ids IS NULL OR array_length(p_event_type_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  SELECT array_agg(e.id ORDER BY e.start_datetime ASC, e.id ASC)
  INTO v_event_ids
  FROM events e
  WHERE e.tenant_id = p_tenant_id
    AND e.event_type_id = ANY(p_event_type_ids)
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

-- No pre-flight duplicate check needed — doesn't touch the unique index.
-- No explicit GRANT needed — same as prior migrations in this file set.
Branch Name
feature/FP-180-adj-4-event-type-filter
Commit Message
FP-180-adj-4: add event-type filter to Prayer Leader/Food Assignment auto-assign, all unchecked by default
Pull Request Description

"Only checked event types are subject to auto-assignment, none checked by default" → selectedEventTypeIds starts []; auto_assign_task_slots's event-selection query gains event_type_id = ANY(p_event_type_ids); listSlotsForTaskUpcoming scoped identically so the slot list and the RPC always agree.
"Section above the list of events, checkboxes, 3–4 across, wrapping" → new grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 card inserted directly above the slot table.
"Events appear as their type is checked" → slots-fetch effect re-runs on every checkbox toggle.
Confirm: "Run auto-assign" disabled until both a non-empty roster and a non-empty event-type selection exist; empty event-type selection on the GET path returns an empty list with a plain prompt message, not an error.

Jira Linkage

PDEEpicID: FP-11
PDEStoryID: FP-180

Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-180-adj-4.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against dev and stop. Do not merge — the user will check out the branch locally, test it, and merge manually.
Include full diffs for every file in the completion report, no elisions.
