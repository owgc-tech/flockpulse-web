DIP-FP-163.md
Story Summary
Adds individual_only to the tasks catalog, a toggle for it on the admin Tasks page, and wires it into both platforms' Task assignee pickers via FP-162's already-built individualOnly prop. Sets Prayer Leader's seed row to true, restoring the constraint it had before Phase 3 unified all tasks onto one picker.
Repo Target
Both flockpulse-web and flockpulse-mobile.
Grounding Check

tasks table (migration 20260719000051) has no such column yet — confirmed live.
Web: EventForm.tsx's Tasks loop (~line 624) already has the exact task object (t) in scope at the GroupMemberChipPicker call site — adding individualOnly={t.individual_only} is a one-line change once the field exists on the Task type/listTasks() response.
FP-162's individualOnly prop is already fully implemented and tested on both platforms — this DIP only needs to supply the value, not build any new picker behavior.
Mobile's equivalent Tasks-loop call site (create.tsx/edit.tsx) needs the same one-line addition, confirmed same shape as web.
Admin Tasks page (/admin/tasks, TasksTable.tsx) has a handleCreate POST flow — needs a checkbox added to both create and inline-edit paths.
Domain rules: no conflict.

Implementation Plan

Migration: ALTER TABLE tasks ADD COLUMN IF NOT EXISTS individual_only BOOLEAN NOT NULL DEFAULT false; then UPDATE tasks SET individual_only = true WHERE name = 'Prayer Leader';.
task.service.ts/task.repository.ts (web) and mobile's tasks.service.ts: widen Task/row types and CRUD functions to include individual_only.
TasksTable.tsx: add a checkbox for "Individual only" to the create form and inline-edit row.
EventForm.tsx: pass individualOnly={t.individual_only} at the Tasks-loop GroupMemberChipPicker call site (not the Target selector — that one stays as-is, always allows both).
Mobile create.tsx/edit.tsx: same one-line addition at their Tasks-loop call site.

Files to Create/Modify
Web: migration; task.service.ts, task.repository.ts, task.types.ts; TasksTable.tsx; EventForm.tsx
Mobile: tasks.service.ts, types.ts; create.tsx, edit.tsx
Branch Name
feature/FP-163-task-individual-only (web), feature/FP-163-task-individual-only-mobile (mobile)
Commit Message
FP-163: add individual_only to tasks, restore Prayer Leader's individual-only constraint
Jira Linkage

PDEEpicID: FP-11
PDEStoryID: FP-163

Stop Point
Save verbatim to documentation/dips/DIP-FP-163.md in both repos, frozen after save. Validate migration locally via supabase db reset (web). Open separate PRs against dev, do not merge. Flag manual remote-migration-apply step.
Include full diffs in the completion report.
