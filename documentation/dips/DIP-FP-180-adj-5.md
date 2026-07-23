DIP-FP-180-adj-5
Story Summary
Two fixes. First: excludes past events from both auto-assign screens. Root cause is that DRAFT status (added in adj-2) is "sticky" — unlike SCHEDULED events, which age into ACTIVE/COMPLETED/LOCKED automatically based on time, a DRAFT event's status never changes regardless of how far in the past its start_datetime/end_datetime is, so a stale draft (like the July 19th test event) stayed eligible forever. Second: reorganizes the sidebar so both auto-assign screens and the Tasks catalog live under a new "Task Management" grouped heading, matching the existing Formation/Reports pattern, instead of a single flat "Tasks" link.
Repo Target
Web (Next.js), owgc-tech/flockpulse-web.
Grounding Check

Root cause confirmed directly from get_event_effective_status()'s own migration comment: "DRAFT/CANCELLED pass through unchanged — sticky, explicit states with no time-based formula." This is a genuine gap in adj-2's own grounding — adding DRAFT to the eligible-status list without accounting for the fact that DRAFT carries no time constraint at all.
Boundary chosen deliberately as end_datetime, not start_datetime: an ACTIVE event (already started, not yet ended) has a past start_datetime by definition — filtering on start_datetime >= now() would wrongly exclude currently-in-progress events, which have been correctly includable since adj-1. Filtering on end_datetime >= now() excludes anything genuinely concluded (including a stale past-dated draft) while preserving in-progress ACTIVE events.
Sidebar precedent confirmed by reading AdminSidebar.tsx directly: two existing group shapes, NavRestoreGroup (clickable parent that redirects to first child, gated wholesale) and NavLabelGroup (plain-text heading, non-navigational, children gated independently — used by Formation/Reports). "Task Management" fits NavLabelGroup exactly, since it isn't itself a real page.
Nav-highlighting collision found and fixed, not left as a known issue: the existing generic isActive(href) does pathname.startsWith(href + '/'), which was never a problem before because nothing under /admin/tasks existed as a sibling nav entry. Now that /admin/tasks/prayer-leader-auto-assign and /admin/tasks/food-assignment-auto-assign are genuine siblings (not detail/sub-pages of the Tasks catalog), the "Task" link would incorrectly show active on both of those pages too, without a fix.
Per your exact wording, the first child's label is "Task" (singular) — a deliberate change from the current standalone item's "Tasks" (plural) label, called out explicitly here so it's not read as a typo.
Role gating for each new link mirrors each destination's actual page-level guard (confirmed by reading all three page.tsx files directly, not assumed): /admin/tasks stays adminOnly: true (Admin-tier), both auto-assign links are adminOnly: false (Leader-tier-or-above) — a Leader-tier user will see the group with 2 of 3 children, matching the existing Formation/Reports independent-child-gating behavior.

Implementation Plan
Part A — exclude past events:

Migration: CREATE OR REPLACE auto_assign_task_slots (same 5-arg signature as adj-4, no DROP needed), adding AND e.end_datetime >= now() to the event-selection query.
Repository (eventTaskAssignment.repository.ts): listSlotsForTaskUpcoming's events query selects end_datetime in addition to the existing columns; the upcomingEvents filter step gains && new Date(e.end_datetime).getTime() >= Date.now() alongside the existing status-based check.

Part B — Task Management nav group:
3. AdminSidebar.tsx:

NavLeaf interface gains an optional exact?: boolean.
isActive gains an optional second parameter: function isActive(href: string, exact?: boolean) — when exact is true, does pathname === href only, no prefix match.
renderChild's parameter type widens to accept an optional exact field and passes it through to isActive.
The flat { href: '/admin/tasks', label: 'Tasks', adminOnly: true } entry in NAV is replaced in place with:

ts     {
       label: 'Task Management',
       children: [
         { href: '/admin/tasks', label: 'Task', adminOnly: true, exact: true },
         { href: '/admin/tasks/prayer-leader-auto-assign', label: 'Auto-assign Prayer Leader', adminOnly: false },
         { href: '/admin/tasks/food-assignment-auto-assign', label: 'Auto-assign Food Assignment', adminOnly: false },
       ],
     },
Files to Create/Modify

supabase/migrations/20260726000060_auto_assign_exclude_past_events.sql (new)
src/features/tasks/eventTaskAssignment.repository.ts (modify — listSlotsForTaskUpcoming only)
src/components/admin/AdminSidebar.tsx (modify — NavLeaf, isActive, renderChild, and the NAV array's Tasks entry)

Migration Files
sql-- DIP-FP-180-adj-5: excludes past events from both auto-assign screens.
-- DRAFT status is sticky (get_event_effective_status's own comment: "no
-- time-based formula"), so a past-dated draft stayed eligible forever once
-- adj-2 added DRAFT to the status allowlist. Filtering on end_datetime, not
-- start_datetime, deliberately preserves ACTIVE (in-progress) events, which
-- have a past start_datetime by definition but should stay eligible.
-- Same 5-arg signature as adj-4 — CREATE OR REPLACE is sufficient, no DROP
-- needed.

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

-- No pre-flight duplicate check needed — doesn't touch the unique index.
-- No explicit GRANT needed — same as prior migrations in this file set.
Branch Name
feature/FP-180-adj-5-exclude-past-events-and-nav-group
Commit Message
FP-180-adj-5: exclude past/stale-draft events from auto-assign scope, group Tasks pages under Task Management nav
Pull Request Description

"Only future events" → end_datetime >= now() added to both the RPC and listSlotsForTaskUpcoming; explicitly not start_datetime, to preserve in-progress ACTIVE events.
"Task Management submenu with Task / Auto-assign Prayer Leader / Auto-assign Food Assignment" → new NavLabelGroup entry in AdminSidebar.tsx, replacing the flat Tasks link.
Include, in the completion report, confirmation that the nav-highlighting fix was manually verified: visiting each of the three new links individually should highlight only that one link, not /admin/tasks simultaneously.

Jira Linkage

PDEEpicID: FP-11
PDEStoryID: FP-180

Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-180-adj-5.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against dev and stop. Do not merge — the user will check out the branch locally, test it, and merge manually.
Include full diffs for every file in the completion report, no elisions.
