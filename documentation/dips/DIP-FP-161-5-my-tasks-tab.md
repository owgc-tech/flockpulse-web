DIP-FP-161-5-my-tasks-tab.md
Story Summary
The final phase of FP-161 — a read-only "My Tasks" mobile tab showing every task assigned to the current member (directly, or via a group they belong to), across all their upcoming events, linked to each event. No accept/decline, no reassignment UI — per the earlier-agreed simplification, reassignment happens by an Admin/event Owner directly changing the assignment elsewhere; this tab is purely informational and navigational.
Repo Target
Both repos — new backend query (web) and new tab (mobile).
Grounding Check

No separate group-membership table exists — confirmed live: membership is resolved via assignments WHERE assignment_type = 'GROUP' AND member_id = X, target_id being the group's id. This is the exact mechanism to reuse for "which groups is this member in," same table already backing Pastoral Leader assignment resolution.
event_tasks_assignments.assignee is JSONB ({group_ids, member_ids}), no FK — matching this codebase's established convention (target/food_assignment historically), resolving "does this assignee include me" requires either a JSONB containment query or fetch-then-filter in JS. This DIP follows the established fetch-and-reduce convention already used throughout this codebase (e.g. getRsvpReportSummary), not a new JSONB query pattern.
"Upcoming" scoping: listEventsForMember's own precedent (attachEffectiveStatus + exclude COMPLETED/LOCKED) is the pattern to mirror — My Tasks should show tasks on events that haven't concluded, matching the philosophy already established for My Events and the Event Owner deactivation guard.
No accept/decline, no notification — explicitly out of scope, per the earlier design conversation.
Domain rules: no conflict — read-only.

Implementation Plan

Web — new service function listMyTaskAssignments(tenantId, memberId): resolve the member's group ids via assignments, fetch all event_tasks_assignments for the tenant, filter in JS to rows where assignee.member_ids includes memberId OR assignee.group_ids overlaps the resolved group ids, join to events (filtered to non-COMPLETED/LOCKED effective status) and tasks for display fields (task name, event name/date/location).
New API route GET /api/event-tasks-assignments/mine — any authenticated member, returns their own resolved list.
Mobile — new tab "My Tasks" (5th tab, alongside My Events/Confirmations/Self-Report): fetches the above endpoint, renders a list (task name, event name/date, tap to navigate to that event's detail screen). Empty state if nothing assigned.
Mobile tab bar: add the new tab to the existing AnimatedTabBar/Tabs.Screen setup (FP-155), with an appropriate icon.

Files to Create/Modify
Web: src/features/tasks/eventTaskAssignment.service.ts/repository; app/api/event-tasks-assignments/mine/route.ts (new)
Mobile: new tab screen under app/(app)/(tabs)/my-tasks/ (or similar); app/(app)/(tabs)/_layout.tsx; a small service function calling the new endpoint
Branch Name
feature/FP-161-5-my-tasks-tab (web), feature/FP-161-5-my-tasks-tab-mobile (mobile)
Jira Linkage

PDEEpicID: FP-11
PDEStoryID: FP-161

Stop Point
Save verbatim to documentation/dips/DIP-FP-161-5-my-tasks-tab.md in both repos, frozen after save. Open separate PRs against dev, do not merge. No destructive migration — read-only feature.
Include full diffs in the completion report.
