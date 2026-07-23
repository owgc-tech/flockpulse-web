DIP-FP-180-adj-6
Story Summary
Replaces the two hardcoded auto-assign screens (Prayer Leader, Food Assignment) with a single generic screen at /admin/tasks/auto-assign: a task dropdown listing every active task in the tenant's catalog, with the roster picker's individuals-only-vs-groups behavior driven live by whichever task is currently selected (tasks.individual_only), not hardcoded per route. This makes the feature work for any tenant's task catalog, not just one shaped like the original test tenant's. Sidebar collapses from three links under "Task Management" to two: "Task" (the catalog) and "Auto-Assign" (this new generic screen).
Repo Target
Web (Next.js), owgc-tech/flockpulse-web.
Grounding Check

No migration needed. auto_assign_task_slots(p_tenant_id, p_task_id, p_roster, p_actor_member_id, p_event_type_ids) already takes p_task_id as a real parameter — confirmed by reading the current live function body directly. Every bit of hardcoding ('Prayer Leader'/'Food Assignment' name resolution, route-fixed individualOnly booleans) lives entirely in the TypeScript service/route/page layer, not SQL.
tasks.individual_only becomes the sole source of truth for the roster picker's individuals-vs-groups behavior, read fresh from the selected task each time. This deliberately reverses adj-1's original defensive stance (route-hardcoded individualOnly, "so the UI contract can't silently drift if the catalog is edited elsewhere") — that concern no longer applies once there's no per-route contract left to drift from; the live DB flag is the contract now, by design.
listTasks(tenantId) (active-only by default, confirmed by reading task.repository.ts directly) is exactly right for populating the dropdown — no additional filtering needed, every active task in the catalog becomes selectable.
Design assumptions, stated explicitly rather than guessed silently:

The task dropdown starts with nothing selected — consistent with the event-type-filter's established "nothing shown until actively chosen" pattern from adj-4. Nothing (roster section, event-type section, slot list) is meaningfully interactive until a task is picked.
Switching the task dropdown clears the roster (a roster built for one task's individual_only constraint isn't necessarily valid for another) but does not clear the event-type selection (that filter is independent of which task is selected).
These are reasonable defaults, not confirmed requirements — flagging them here so they're easy to correct if wrong.


Confirmed no other callers of getTaskByName exist outside this feature before removing it (grep across src/ and app/) — safe to delete outright, not just deprecate.
Role gating unchanged throughout: Leader-tier-or-above, matching every existing route/page in this feature.

Implementation Plan

Repository (eventTaskAssignment.repository.ts): replace getTaskByName(tenantId, name) with getTaskById(tenantId, taskId): Promise<{ id: string; name: string; individual_only: boolean }> — same tenant-scoped-and-active lookup, keyed by id instead of name (also returns name now, needed for display since there's no longer a hardcoded label). listSlotsForTaskUpcoming and runAutoAssignTaskSlots are unchanged — already fully generic.
Service (autoAssign.service.ts): remove PRAYER_LEADER_TASK_NAME/FOOD_ASSIGNMENT_TASK_NAME and all four named wrapper functions. Replace with:

getTaskAutoAssignData(tenantId, taskId, eventTypeIds): resolves via getTaskById, returns { task, slots } (task includes name and individual_only for the client).
runTaskAutoAssign(tenantId, taskId, roster, actorMemberId, eventTypeIds): resolves via getTaskById, calls validateRoster(roster, tenantId, { individualOnly: task.individual_only }) — reading the live flag instead of a route-fixed boolean — then validateEventTypeIds, then runs the RPC.


API routes — consolidate from four to two:

GET /api/tasks/auto-assign/slots?task_id=X&event_type_ids=a,b,c — task_id is required (MISSING_FIELD 400 if absent, consistent with how event_id/task_id are already required elsewhere in this codebase); event_type_ids keeps its existing empty-is-valid posture.
POST /api/tasks/auto-assign — body { task_id, roster, event_type_ids }; same validation-error handling as today (VALIDATION_ERROR → 422, NOT_FOUND → 404).
Delete prayer-leader/route.ts, prayer-leader/slots/route.ts, food-assignment/route.ts, food-assignment/slots/route.ts, and their now-empty parent directories.


Page: single app/admin/(shell)/tasks/auto-assign/page.tsx, Leader-tier gated (matching the two it replaces), fetches listTasks(tenantId), listMembers(tenantId), listGroups(tenantId), listEventTypes(tenantId), passes all four plus token to the panel. No more server-side "resolve one fixed task before rendering" step — nothing to resolve until the organizer picks one. Delete prayer-leader-auto-assign/page.tsx and food-assignment-auto-assign/page.tsx directories entirely.
TaskAutoAssignPanel.tsx rework:

Props become { tasks: TaskRow[], groups: GroupOption[], members: MemberOption[], eventTypes: EventTypeOption[], token: string }, drop taskLabel, taskId, individualOnly, slotsEndpoint, runEndpoint (all now derived internally).
New state selectedTaskId: string (starts ''), rendered as a <select> at the top of the panel, above the Roster card, listing every task in tasks by name.
individualOnly and taskLabel become derived values: tasks.find(t => t.id === selectedTaskId)'s individual_only/name, falling back sensibly when nothing is selected yet.
Changing selectedTaskId resets roster to [] (see Grounding Check); selectedEventTypeIds is untouched by a task change.
Slots-fetch effect now keys off selectedTaskId (in addition to selectedEventTypeIds) and short-circuits to an empty slot list with no fetch at all when selectedTaskId is ''.
handleRun and the "Run auto-assign" button's disabled condition both gain !selectedTaskId alongside the existing roster/event-type checks; POST body gains task_id: selectedTaskId.
The manual per-slot create-path (POST /api/event-tasks-assignments) uses selectedTaskId in place of the old fixed taskId prop.


AdminSidebar.tsx: Task Management's children shrinks to two entries:

ts   {
     label: 'Task Management',
     children: [
       { href: '/admin/tasks', label: 'Task', adminOnly: true, exact: true },
       { href: '/admin/tasks/auto-assign', label: 'Auto-Assign', adminOnly: false },
     ],
   },
The exact: true fix from adj-5 already covers the collision between /admin/tasks and any nested sibling path (/admin/tasks/auto-assign), so no further nav-logic changes are needed there — just the children array contents.
Files to Create/Modify
New:

app/api/tasks/auto-assign/route.ts
app/api/tasks/auto-assign/slots/route.ts
app/admin/(shell)/tasks/auto-assign/page.tsx

Modify:

src/features/tasks/eventTaskAssignment.repository.ts (getTaskByName → getTaskById)
src/features/tasks/autoAssign.service.ts (remove hardcoded wrappers, add generic functions)
app/admin/(shell)/tasks/_shared/TaskAutoAssignPanel.tsx (dropdown-driven rework)
src/components/admin/AdminSidebar.tsx (2 children instead of 3)

Delete:

app/api/tasks/auto-assign/prayer-leader/route.ts
app/api/tasks/auto-assign/prayer-leader/slots/route.ts
app/api/tasks/auto-assign/food-assignment/route.ts
app/api/tasks/auto-assign/food-assignment/slots/route.ts
app/admin/(shell)/tasks/prayer-leader-auto-assign/page.tsx
app/admin/(shell)/tasks/food-assignment-auto-assign/page.tsx

Migration Files
None — no SQL changes required for this DIP.
Branch Name
feature/FP-180-adj-6-generic-task-auto-assign
Commit Message
FP-180-adj-6: replace hardcoded Prayer Leader/Food Assignment screens with a single generic task-dropdown auto-assign screen
Pull Request Description

"Dropdown for all tasks, choose one to auto-assign for" → single /admin/tasks/auto-assign page, selectedTaskId dropdown populated from listTasks(tenantId).
"Other tenants may not have Prayer Leader/Food Assignment" → no task names hardcoded anywhere in the new code; individual_only read live per-selection from the catalog.
"Task Management > Task / Auto-Assign" → AdminSidebar.tsx's children array updated to exactly these two entries with this exact wording.
Include, in the completion report, confirmation (via git diff dev [branch] --) that no supabase/migrations/ file was touched, since this DIP is TypeScript-only.
Include confirmation that the four old routes and two old pages were fully deleted, not just left unreferenced.

Jira Linkage

PDEEpicID: FP-11
PDEStoryID: FP-180

Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-180-adj-6.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against dev and stop. Do not merge — the user will check out the branch locally, test it, and merge manually.
Include full diffs for every file in the completion report — full git diff output or complete file contents for new files, no elisions — and explicit confirmation of each deleted file/directory.
