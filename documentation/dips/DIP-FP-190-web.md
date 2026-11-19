### DIP 1 of 2 — Web

### Story Summary
Adds a member-unavailability data model and a hard block preventing an individual member from being assigned a task on a date they're marked unavailable — enforced at the database layer across both manual write paths (the event form's task pickers and the Auto-Assign screen's inline per-slot editing), with an actionable error naming who's unavailable. The automated round-robin itself is deliberately left untouched; instead, after it runs, a conflict report is computed by cross-referencing its own results against the new unavailability data. No web UI for filing — mobile-only, self-service (this DIP is API + enforcement only).

### Repo Target
Web (Next.js) — schema, hard-block enforcement, API routes for filing/listing (consumed by mobile), and the auto-assign conflict report.

### Grounding Check
Confirmed live against `owgc-tech/flockpulse-web` `dev`:
- `event_tasks_assignments.assignee` is `{ group_ids, member_ids }` JSONB (same shape as `events.target`) — the hard block checks only `member_ids`, never `group_ids`, matching the story's explicit individual-only scope.
- **The two manual write paths are both plain repository functions, not RPCs**: `insertEventTaskAssignment()`/`patchEventTaskAssignment()` (`eventTaskAssignment.repository.ts`) — used by both `EventForm.tsx`'s task pickers and the Auto-Assign screen's inline manual editing (confirmed via the `getTaskById()` comment referencing "the generic auto-assign screen's task dropdown" — same repository, same functions, both call sites).
- **A critical design conflict, found and resolved, not glossed over**: `auto_assign_task_slots()` (latest definition: `20260726000060_auto_assign_exclude_past_events.sql`, `RETURNS SETOF event_tasks_assignments`) also inserts into this same table internally. A plain `BEFORE INSERT` trigger on `event_tasks_assignments` would incorrectly block the round-robin's own inserts whenever it happens to assign an unavailable member — directly contradicting the story's explicit "runs exactly as today, no skip logic" requirement. **Resolution**: the RPC sets a session-scoped flag (`SET LOCAL app.skip_unavailability_check = 'true'`) before its own inserts; the trigger checks for and honors that flag, skipping the check only for that one caller. This keeps the guard as a real database-layer trigger (matching every other hard-block precedent in this codebase — Assigned Leader, group/event ownership) while correctly exempting the one caller the story says must be exempt.
- `RETURNS SETOF event_tasks_assignments` means the auto-assign RPC's result already includes `event_id` and `assignee` for every row it touched — the conflict report can be computed entirely in the calling service layer (`autoAssign.service.ts`) after the RPC returns, cross-referenced against the event's date and the new unavailability table, with zero changes to the RPC itself.
- `DateTimePicker`/`DateTimePickerAndroid` (`@react-native-community/datetimepicker`) is already used in mobile's `profile/edit.tsx` for `birthdate` — real precedent for DIP 2's from/to range picker, not something to introduce fresh.
- No direct client-side table writes exist anywhere in mobile for member data — everything goes through `apiFetch`/service-role API routes. New unavailability endpoints follow the same convention.

### Implementation Plan
1. **New migration**: `member_unavailability_ranges` table — `id, tenant_id, member_id, start_date DATE, end_date DATE, created_at`. Cross-tenant safety trigger (per Section 5.4's standing rule) confirming `member_id`'s tenant matches. No soft-delete — matches `event_tasks_assignments`' own hard-delete precedent, confirmed above; a filed range that's later removed is genuinely gone, not archived.
2. **New trigger `block_task_assignment_if_member_unavailable()`** on `event_tasks_assignments` (`BEFORE INSERT OR UPDATE`): if `current_setting('app.skip_unavailability_check', true) = 'true'`, return `NEW` immediately (auto-assign's exemption). Otherwise, look up the event's `start_datetime`/`end_datetime` (cast to date), extract `NEW.assignee->'member_ids'`, and for each member_id, check for any overlapping row in `member_unavailability_ranges`. On a match, `RAISE EXCEPTION` naming the member (first/last name, joined) and the resolution path, e.g. `'Cannot assign %: marked unavailable on this date — ask them to adjust their unavailability if this assignment is needed', v_member_name`.
3. **`eventTaskAssignment.service.ts`**: catch the trigger's `P0001`, map to a new `MEMBER_UNAVAILABLE` error code (checked against Section 5.6's canonical list first — nothing existing fits this specific case) with the member's name attached structurally, same convention as `assignedMemberCount` elsewhere.
4. **`auto_assign_task_slots()`**: add `SET LOCAL app.skip_unavailability_check = 'true';` as the first statement in the function body — no other change to its logic.
5. **New `member_unavailability.repository.ts`/`.service.ts`**: list/create/delete for a member's own ranges (self-service — `member_id` always derived from the caller's own session, never a request parameter, mirroring FP-187's "structurally impossible to act on anyone but yourself" pattern).
6. **New routes**: `GET/POST /api/members/me/unavailability`, `DELETE /api/members/me/unavailability/[id]`.
7. **`autoAssign.service.ts`**: after `runAutoAssignTaskSlots()` returns, cross-reference each returned row's `event_id` (→ event date) and `assignee.member_ids` against `member_unavailability_ranges`, returning a conflict list (member name, event name/date) alongside the normal result — UI for displaying this is DIP 2's concern.

### Files to Create/Modify
- New migration in `supabase/migrations/`
- `src/features/tasks/eventTaskAssignment.service.ts` (modify)
- `src/features/members/member_unavailability.repository.ts`, `.service.ts` (new)
- `app/api/members/me/unavailability/route.ts`, `app/api/members/me/unavailability/[id]/route.ts` (new)
- `src/features/tasks/autoAssign.service.ts` (modify)

### Migration Files (if applicable)
`member_unavailability_ranges` table + cross-tenant trigger; `block_task_assignment_if_member_unavailable()` trigger on `event_tasks_assignments`; `CREATE OR REPLACE FUNCTION auto_assign_task_slots(...)` adding the `SET LOCAL` exemption line (no `DROP FUNCTION` needed — neither its parameter list nor `RETURNS SETOF event_tasks_assignments` changes, per the standing house rule). Written to disk, applied locally only, never against the remote database directly.

### Branch Name
feature/FP-190-web-unavailability-hard-block

### Commit Message
FP-190-web: hard-block task assignment on member unavailability, auto-assign conflict report

### Pull Request Description
Maps to FP-190's web-side acceptance criteria: new self-service unavailability data model, a database-layer hard block on both manual assignment paths (individual-only, per the story's explicit scope), actionable error naming who's unavailable, and a post-run conflict report for auto-assign — with the round-robin itself genuinely unmodified in behavior, only exempted from the new trigger via a session flag. Explicitly test: assigning an unavailable individual is blocked with a clear message; assigning a group containing an unavailable member is *not* blocked (per scope); running auto-assign that happens to land on an unavailable member succeeds and shows up in the conflict report, not silently or as a hard failure.

### Jira Linkage
- PDEEpicID: FP-11
- PDEStoryID: FP-190

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-190-web.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against dev and stop. Do not merge — the user will check out the branch locally, test it against the deployed dev environment, and merge manually.

Include full diffs for every file in your completion report per Section 5, rule 12 — not a summary.
