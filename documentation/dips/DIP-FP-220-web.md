### DIP — FP-220 (Web)

### Story Summary
Adds a configurable per-tenant limit on how many groups/individuals (combined) can be assigned to a non-individual_only task — a new Community Settings field, default 5, enforced both in the assignment picker UI and server-side.

### Repo Target
Web (Next.js) — Community Settings form + API, plus the shared task-assignment picker.

### Grounding Check
Confirmed live against `owgc-tech/flockpulse-web` `dev`:
- `rsvp_closure_days_default` is the exact precedent pattern to mirror: a `tenants` column, selected in `getTenantSettings`'s query, validated with a clear range check in `updateTenantSettings`, exposed through `PATCH /api/tenant/settings`'s body.
- `GroupMemberChipPicker` (`app/admin/(shell)/events/GroupMemberChipPicker.tsx`) has no selection-limiting concept today — `individualOnly` is the closest existing precedent (an optional prop that conditionally restricts what's selectable).
- **This same picker is also used for event Target audience** (intentionally uncapped) — the new limit must be an opt-in prop, applied only where `TaskAutoAssignPanel.tsx` uses it for task assignment, never affecting Target audience selection.

### Implementation Plan
1. New migration: add `task_assignment_limit` (integer, default 5) to `tenants`, following the exact column/constraint style of `rsvp_closure_days_default`.
2. `getTenantSettings`/`updateTenantSettings` (`src/features/tenant/service.ts`): add the new field to the select list, the input type, and a validation check (reasonable bounds — confirm exact range at implementation time, e.g. 1–50).
3. `PATCH /api/tenant/settings` (`app/api/tenant/settings/route.ts`): thread `taskAssignmentLimit` through the body, same as every other setting.
4. `CommunitySettingsForm.tsx`: add the new field, labeled exactly **"Limit to Number of Assigned Individual/Groups"**, following the same input/display pattern as `rsvpClosureDaysDefault`.
5. `GroupMemberChipPicker.tsx`: add an optional `maxSelections?: number` prop — when `group_ids.length + member_ids.length` reaches this number, further selection is disabled with a clear message, mirroring how `individualOnly` already conditionally restricts selection.
6. `TaskAutoAssignPanel.tsx` (both usages of the picker, confirmed two call sites): pass `maxSelections={tenantSettings.taskAssignmentLimit}` — only for non-`individualOnly` tasks, since those are already hard-capped at 1 by the existing `individualOnly` behavior.
7. Server-side enforcement: confirm at implementation time which route actually saves a task assignment, and add the same combined-count check there — never trust the client-side cap alone.

### Files to Create/Modify
- New migration file (exact filename per this repo's dated-migration convention)
- `src/features/tenant/service.ts` (modify)
- `app/api/tenant/settings/route.ts` (modify)
- `app/admin/(shell)/community/CommunitySettingsForm.tsx` (modify)
- `app/admin/(shell)/events/GroupMemberChipPicker.tsx` (modify)
- `app/admin/(shell)/tasks/_shared/TaskAutoAssignPanel.tsx` (modify)
- The task-assignment save route (confirm exact path at implementation time; modify)

### Migration Files (if applicable)
None.

### Branch Name
feature/FP-220-web-task-assignment-limit

### Commit Message
FP-220-web: configurable limit on groups/individuals assigned to a task

### Pull Request Description
Maps to FP-220's acceptance criteria: a new Community Settings field, default 5, caps combined group+individual task assignments, enforced both in the picker UI and server-side. Individual-only tasks are untouched — already correctly capped at 1/0. Target audience selection (the same picker, different context) is confirmed unaffected. Confirm in the PR the exact validation bounds chosen for the setting itself, and which route actually enforces the limit server-side.

### Jira Linkage
- PDEEpicID: FP-8
- PDEStoryID: FP-220

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-220-web.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against dev and stop. Do not merge — the user will check out the branch locally, test it against the deployed dev environment, and merge manually.

Include full diffs for every file in your completion report per Section 5, rule 12 — not a summary.
