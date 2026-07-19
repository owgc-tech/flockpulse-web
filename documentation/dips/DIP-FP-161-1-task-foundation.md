DIP-FP-161-1-task-foundation.md
Story Summary
Phase 1 of 5 for FP-161 (Dynamic Event Task system). Establishes the foundation: a tasks catalog (admin-configurable list of task types — "Prayer Leader," "Food Assignment," "Music," and any future additions like "Games Organizer"), and event_tasks_assignments (the table linking a specific event's task to whoever's assigned, using the same flexible group-and/or-individual selector food_assignment already uses). This DIP covers schema, service/repository layers, API routes, and an admin CRUD page for the tasks catalog only — wiring this into the actual Event Form, and retiring the old prayer_leader_member_id/food_assignment fields, is Phase 3, not this DIP.
Repo Target
Web (Next.js) — owgc-tech/flockpulse-web.
Grounding Check
Confirmed live against dev:

event_types' exact structure and full stack (migration 20260629000016, plus FP-131's later work) is the precedent to mirror for the tasks catalog: id, tenant_id, name, deleted_at, created_at, updated_at, RLS (SELECT open to all tenant members, INSERT/UPDATE Admin-tier only via caller_is_admin()), create_X_with_audit/update_X_with_audit SECURITY DEFINER RPCs, a service+repository layer, GET/POST /api/tasks + PATCH /api/tasks/:id, and an /admin/tasks page mirroring /admin/event-types (list, inline create, inline rename, archive/restore via deleted_at). tasks does not need event_types' code column — nothing in this DIP's scope branches on a specific task by a stable code the way event_types' FORMATION check does; name alone is sufficient.
food_assignment's JSONB shape (events.food_assignment, matching the EventTargetSelector type already used for target) is the exact shape to reuse for event_tasks_assignments.assignee — { group_ids: string[], member_ids: string[] } — giving every task the same "individual, group, or a mix" assignment capability, confirmed already working today for Food Assignment specifically.
events.created_by_member_id already exists — confirmed present in listEvents's own select list — this is what Phase 2's owner_member_id will default from; not touched in this DIP, just confirmed available for later.
Cross-tenant referential safety (standing rule): event_tasks_assignments has two real foreign keys (event_id, task_id) — needs a BEFORE INSERT OR UPDATE trigger validating both belong to the same tenant_id as the assignment row, matching the established pattern used for every other tenant-scoped table with FKs to other tenant-scoped tables. The assignee JSONB's group_ids/member_ids aren't real FK columns (same as target/food_assignment today) — their tenant-membership validation happens at the app/service layer, matching how those existing JSONB target fields are already validated, not via a DB constraint.
No soft-delete on event_tasks_assignments rows — deliberately mirrors event_attendees's hard-delete precedent (confirmed during FP-156), since there's no described need to retain a history of which tasks used to be on an event; the standing audit_log mechanism covers history if ever needed, without a dedicated soft-delete column.
Seed data: this migration seeds three tasks rows — "Prayer Leader," "Food Assignment," "Music" — per tenant, so Phase 3 has real catalog rows to reference by name when wiring the "always shown as optional slots" behavior into the Event Form. Mirrors event_types' original migration seeding a "General" default type.
Domain rules: no conflict — new tables, no changes to any RSVP/attendance/formation invariant.

Implementation Plan

Migration: create tasks (mirroring event_types' structure minus code), its RLS policies, and create_task_with_audit/update_task_with_audit RPCs (mirroring create_event_type_with_audit/update_event_type_with_audit exactly). Create event_tasks_assignments (id, tenant_id, event_id, task_id, assignee JSONB, created_at, updated_at), its cross-tenant safety trigger, and basic RLS (mirroring event_attendees' policy shape — tenant-scoped read, write gated to Leader-tier-or-above for now, matching how Prayer Leader/Food Assignment can be edited today; this DIP does not yet know about owner_member_id, since that's Phase 2 — flagged explicitly so Phase 2/3 remembers to tighten this once the Owner field exists). Seed the three default tasks rows per existing tenant.
src/features/tasks/task.service.ts + task.repository.ts: mirror event-type.service.ts/event-type.repository.ts exactly — listTasks, createTask, updateTask (including soft-delete via deletedAt).
src/features/tasks/eventTaskAssignment.service.ts + repository: basic CRUD for event_tasks_assignments — listTaskAssignmentsForEvent(eventId), createTaskAssignment, updateTaskAssignment, deleteTaskAssignment — validating assignee's group_ids/member_ids belong to the same tenant, mirroring the existing target/food_assignment validation pattern.
API routes: app/api/tasks/route.ts + app/api/tasks/[id]/route.ts (mirroring /api/event-types exactly). app/api/event-tasks-assignments/route.ts (or nested under events — implementer's call on the cleanest REST shape, not dictated here) for basic assignment CRUD, Leader-tier-or-above for now.
app/admin/(shell)/tasks/page.tsx + TasksTable.tsx: mirror /admin/event-types exactly — Admin-tier-only page, list + inline create + inline rename + archive/restore.
AdminSidebar.tsx: add a "Tasks" nav item, admin-only, placed sensibly near Event Types.

Files to Create/Modify

supabase/migrations/20260719000051_task_foundation.sql (new)
src/features/tasks/task.service.ts, task.repository.ts, task.types.ts (new)
src/features/tasks/eventTaskAssignment.service.ts, repository, types (new)
app/api/tasks/route.ts, app/api/tasks/[id]/route.ts (new)
app/api/event-tasks-assignments/route.ts (new, or nested path — implementer's call)
app/admin/(shell)/tasks/page.tsx, TasksTable.tsx (new)
src/components/admin/AdminSidebar.tsx

Migration Files
Full SQL to be written by CC following the Implementation Plan above, mirroring event_types_and_fk.sql's exact structure/conventions (idempotency guards, RLS, audit-logged RPCs) adapted per the Grounding Check's specifics (no code column, seed three rows, add the cross-tenant trigger for event_tasks_assignments's two FK columns).
Branch Name
feature/FP-161-1-task-foundation
Commit Message
FP-161 (1/5): task foundation — tasks catalog + event_tasks_assignments table
Pull Request Description
Maps to acceptance criteria: tasks catalog with full admin CRUD (mirrors Event Types exactly), event_tasks_assignments schema supporting individual/group/mixed assignment (mirrors Food Assignment's existing shape), cross-tenant safety, seeded with the three core task types. Explicitly not wired into the Event Form yet — that's Phase 3.
Jira Linkage

PDEEpicID: FP-11 (EPIC-3 — Event Lifecycle Management)
PDEStoryID: FP-161

Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-161-1-task-foundation.md, frozen after save. npm run build must pass cleanly. Validate the migration locally via supabase db reset. Open PR against dev, do not merge. Flag the manual remote-migration-apply step.
Include full diffs in the completion report.
