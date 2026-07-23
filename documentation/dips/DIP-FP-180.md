# DIP-FP-180

### Story Summary
Two dedicated admin screens — Prayer Leader and Food Assignment — let an organizer hand-pick a small explicit roster (individuals only for Prayer Leader; individuals and/or groups for Food Assignment), order it by priority, then trigger a round-robin auto-fill of that task's open slots across upcoming events. Music is explicitly out of scope. Neither screen touches the general task catalog or any other task type — the roster is always a deliberately small, hand-picked subset the admin selects fresh each visit, never "everyone eligible." After a run, every slot stays manually editable, re-running overwrites existing assignments (with a confirm warning), and a live roster-scoped count table at the bottom of each page shows how evenly assignments are currently distributed so the admin can spot and fix imbalance.

### Repo Target
Web (Next.js), `owgc-tech/flockpulse-web`. Web-only per the Jira label; no mobile work.

### Grounding Check
- No conflict with Section 4 invariants — this only writes `event_tasks_assignments.assignee`, never `attendance` or `rsvps`.
- Schema verified live, not from spec: `tasks` (catalog, has `individual_only`), `event_tasks_assignments` (`assignee JSONB` = `{group_ids, member_ids}`), no stored effective-status column on `events` — derived via `get_event_effective_status()`.
- "Upcoming events" = `SCHEDULED`/`ACTIVE`, reusing FP-164's precedent (an allowlist, not a denylist) — flagging as an assumption, not an explicit AC.
- Cross-tenant safety: the RPC only touches `event_tasks_assignments` rows already filtered by `tenant_id`; roster member/group IDs are validated tenant-scoped-and-active in the TS service layer before the RPC runs (mirrors `validateAssignee()`). No new tenant-scoped table, so no new trigger required.
- Atomicity: round-robin fill is one `SECURITY DEFINER` function doing all row updates in a single transaction, not N client calls.
- Canonical error codes: reusing `VALIDATION_ERROR`, already established for this feature area.
- **Individual_only enforcement is route-level, not just DB-level**: even though `tasks.individual_only` happens to be `true` for the "Prayer Leader" row, the Prayer Leader route hardcodes rejection of any `type: 'group'` roster entry regardless of what that DB flag currently says — the UI contract (Prayer Leader = individuals only, Food Assignment = individuals + groups) shouldn't silently drift if that catalog flag is ever edited elsewhere.
- **No roster persistence** — the roster is rebuilt by the admin every time either page loads; nothing is saved to the database between sessions, matching "each run starts fresh." Flagging as an assumption: last-used-roster memory is additional scope, not built here.
- **Task name resolution is hardcoded server-side**, not client-supplied: both API routes look up the task by the literal name `'Prayer Leader'` / `'Food Assignment'` within the tenant's catalog rather than accepting a `task_id` from the client.
- Summary table is a pure client-side derived view (roster state × already-fetched slot list) — no new endpoint, per the "just the count is enough" direction.
- **File-modification scope confirmed by reading both files directly**: `TasksTable.tsx` is pure CRUD table/form logic for the task catalog (create/edit/toggle) with no page-level header or nav content — it is *not* touched by this DIP. The `<h1>Tasks</h1>` heading and description block live in `page.tsx` itself; the two new nav links are inserted there, immediately after that heading/description `<div>` and before `<TasksTable .../>`. No other line in `page.tsx` changes.

### Implementation Plan

1. **Migration** — add `auto_assign_task_slots(p_tenant_id, p_task_id, p_roster, p_actor_member_id)`: a `SECURITY DEFINER` function taking a task ID (resolved server-side, never client-facing) and an ordered roster array, that collects every `event_tasks_assignments` row for that task on upcoming (`SCHEDULED`/`ACTIVE`) events, orders them deterministically (`events.start_datetime ASC, id ASC`), and round-robins `p_roster[i % roster_length]` onto each slot in one transaction, unconditionally overwriting whatever was there. Same internal function backs both features — task-agnostic at the SQL layer, task-fixed at the API layer above it.

2. **Types** (`src/features/tasks/eventTaskAssignment.types.ts`, append only) —
   ```ts
   export interface RosterEntry { type: 'member' | 'group'; id: string }
   export interface TaskAutoAssignSlotRow {
     id: string; event_id: string; event_name: string;
     start_datetime: string; assignee: AssigneeSelector | null;
   }
   ```

3. **Repository** (`eventTaskAssignment.repository.ts`, append only — do not touch `insertEventTaskAssignment`, `patchEventTaskAssignment`, `getEventTaskAssignment`, `listEventTaskAssignmentsForEvent`, or `deleteEventTaskAssignment`) — add:
   - `getTaskByName(tenantId, name)`: single lookup, `deleted_at IS NULL`, throws `NOT_FOUND` if missing.
   - `listSlotsForTaskUpcoming(tenantId, taskId)`: joins `event_tasks_assignments` → `events`, filtered to `SCHEDULED`/`ACTIVE` via `get_events_effective_statuses()`, ordered by `start_datetime`.
   - `runAutoAssignTaskSlots(tenantId, taskId, roster, actorMemberId)`: calls the RPC via the service-role client.

4. **Service** (new file `src/features/tasks/autoAssign.service.ts`) — shared internal logic, four exported entry points so the fixed-task contract lives at this boundary:
   - `validateRoster(roster, tenantId, { individualOnly })`: non-empty check; if `individualOnly`, rejects any `type: 'group'` entry (`VALIDATION_ERROR`); validates every ID is tenant-scoped and active (mirrors `validateAssignee`).
   - `getPrayerLeaderAutoAssignData(tenantId)` / `getFoodAssignmentAutoAssignData(tenantId)`: resolve the fixed task by name, return `{ task, slots }`.
   - `runPrayerLeaderAutoAssign(tenantId, roster, actorMemberId)`: resolves task, `validateRoster(..., { individualOnly: true })`, runs RPC.
   - `runFoodAssignmentAutoAssign(tenantId, roster, actorMemberId)`: resolves task, `validateRoster(..., { individualOnly: false })`, runs RPC.

5. **API routes** (Leader-tier-or-above, matching `event-tasks-assignments`'s existing gating):
   - `GET /api/tasks/auto-assign/prayer-leader/slots`
   - `POST /api/tasks/auto-assign/prayer-leader` — body `{ roster: RosterEntry[] }`
   - `GET /api/tasks/auto-assign/food-assignment/slots`
   - `POST /api/tasks/auto-assign/food-assignment` — body `{ roster: RosterEntry[] }`

6. **UI** — one shared presentational component, two thin pages:
   - `app/admin/(shell)/tasks/_shared/TaskAutoAssignPanel.tsx`: props `{ taskLabel, individualOnly, slotsEndpoint, runEndpoint, groups, members }`. Renders: roster builder (`GroupMemberChipPicker` + new up/down reorder controls on the resulting chips), "Run auto-assign" button (confirm modal if any slot already has an assignee), slot list with inline manual-edit picker per row (existing `PATCH /api/event-tasks-assignments/[id]`), and the roster-scoped summary count table — computed client-side by matching each roster entry's ID against `assignee.member_ids`/`assignee.group_ids` across the current slot list, recalculated on every local edit.
   - `app/admin/(shell)/tasks/prayer-leader-auto-assign/page.tsx`: server component, Leader-tier gated (like `events/page.tsx`), fetches `listMembers` + `getPrayerLeaderAutoAssignData`, renders the panel with `individualOnly={true}`.
   - `app/admin/(shell)/tasks/food-assignment-auto-assign/page.tsx`: same shape, fetches `listMembers` + `listGroups` + `getFoodAssignmentAutoAssignData`, renders the panel with `individualOnly={false}`.
   - **`app/admin/(shell)/tasks/page.tsx` — targeted edit only**: insert two links ("Auto-assign Prayer Leader", "Auto-assign Food Assignment") pointing at the two new routes, placed right after the existing `<h1>Tasks</h1>` / description block and before `<TasksTable initialTasks={tasks} token={token} />`. Every other line in this file — the auth/role resolution, `listTasks` call, the props passed to `TasksTable` — stays untouched.

### Files to Create/Modify

| File | Add / Modify |
|---|---|
| `supabase/migrations/20260722000055_auto_assign_task_slots.sql` | New |
| `src/features/tasks/eventTaskAssignment.types.ts` | Modify — append two interfaces only |
| `src/features/tasks/eventTaskAssignment.repository.ts` | Modify — append three functions only |
| `src/features/tasks/autoAssign.service.ts` | New |
| `app/api/tasks/auto-assign/prayer-leader/slots/route.ts` | New |
| `app/api/tasks/auto-assign/prayer-leader/route.ts` | New |
| `app/api/tasks/auto-assign/food-assignment/slots/route.ts` | New |
| `app/api/tasks/auto-assign/food-assignment/route.ts` | New |
| `app/admin/(shell)/tasks/_shared/TaskAutoAssignPanel.tsx` | New |
| `app/admin/(shell)/tasks/prayer-leader-auto-assign/page.tsx` | New |
| `app/admin/(shell)/tasks/food-assignment-auto-assign/page.tsx` | New |
| `app/admin/(shell)/tasks/page.tsx` | Modify — insert two nav links only, no other change |

### Migration Files

```sql
-- DIP-FP-180: single-task round-robin auto-assignment pass, backing both the
-- Prayer Leader and Food Assignment auto-assign screens. Task-agnostic at
-- this layer — which two tasks it's reachable for is an API-layer decision
-- (autoAssign.service.ts), not enforced here. Roster is trusted pre-validated
-- (tenant-scoped, active, individual_only-compliant) by the caller, mirroring
-- validateAssignee's existing precedent elsewhere in this feature area.
-- Overwrites existing assignee values unconditionally on every call — the
-- UI's confirm-before-run warning is what makes that safe, not this function.

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
  v_slot_ids UUID[];
  v_roster_len INT := jsonb_array_length(p_roster);
  v_entry JSONB;
  v_type TEXT;
  v_rid UUID;
  v_new_assignee JSONB;
  i INT;
BEGIN
  SELECT array_agg(eta.id ORDER BY e.start_datetime ASC, eta.id ASC)
  INTO v_slot_ids
  FROM event_tasks_assignments eta
  JOIN events e ON e.id = eta.event_id
  WHERE eta.tenant_id = p_tenant_id
    AND eta.task_id = p_task_id
    AND public.get_event_effective_status(e.id) IN ('SCHEDULED', 'ACTIVE');

  IF v_slot_ids IS NULL OR v_roster_len = 0 THEN
    RETURN;
  END IF;

  FOR i IN 1..array_length(v_slot_ids, 1) LOOP
    v_entry := p_roster -> ((i - 1) % v_roster_len);
    v_type := v_entry->>'type';
    v_rid := (v_entry->>'id')::UUID;

    IF v_type = 'group' THEN
      v_new_assignee := jsonb_build_object('group_ids', jsonb_build_array(v_rid));
    ELSE
      v_new_assignee := jsonb_build_object('member_ids', jsonb_build_array(v_rid));
    END IF;

    UPDATE event_tasks_assignments
    SET assignee = v_new_assignee, updated_at = now()
    WHERE event_tasks_assignments.id = v_slot_ids[i];
  END LOOP;

  RETURN QUERY
  SELECT eta.id, eta.event_id, eta.task_id, eta.assignee, eta.created_at, eta.updated_at
  FROM event_tasks_assignments eta
  WHERE eta.id = ANY(v_slot_ids)
  ORDER BY eta.updated_at DESC;
END;
$$;

-- No explicit GRANT needed: service_role already covered by migration
-- 20260629000011's ALTER DEFAULT PRIVILEGES; only ever called via the
-- service-role client, matching every other RPC in this file set.
```

### Branch Name
`feature/FP-180-prayer-leader-food-assignment-auto-assign`

### Commit Message
`FP-180: add Prayer Leader and Food Assignment round-robin auto-assignment screens`

### Pull Request Description
Map each item explicitly:
- "Admin picks a small explicit roster before anything runs" → roster builder is a required, standalone step on both pages; nothing round-robins until the admin has hand-picked and ordered a roster.
- "Prayer Leader roster is individuals only; Food Assignment is individuals + groups" → `individualOnly` prop on the shared panel, enforced client-side via the picker and server-side via `validateRoster`'s route-fixed flag.
- "Auto-pass fills open slots via round-robin across only the chosen roster" → `auto_assign_task_slots` RPC.
- "Every assignment stays manually editable" → inline per-slot picker via existing `PATCH /api/event-tasks-assignments/[id]`.
- "Re-run overwrites manual edits, with a warning" → confirm modal gates the `POST`; RPC always overwrites unconditionally.
- "Summary table of assignment counts, roster-scoped, counts only" → client-derived table at the bottom of each panel, recalculated on every local edit.
- Music excluded → not referenced anywhere in this feature; only "Prayer Leader" and "Food Assignment" are resolvable task names.
- Also confirm: `TasksTable.tsx` untouched (`git diff dev [branch] -- "app/admin/(shell)/tasks/TasksTable.tsx"` showing zero output), and `page.tsx`'s diff is limited to the two-link insertion described above.

### Jira Linkage
- PDEEpicID: FP-11
- PDEStoryID: FP-180

### Stop Point
Save this DIP verbatim to `documentation/dips/DIP-FP-180.md` and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against `dev` and stop. Do not merge — the user will check out the branch locally, test it, and merge manually.

Include full diffs for every file in the completion report — full `git diff` output or complete file contents for new files, no elisions — and the explicit zero-output `git diff` proof for `TasksTable.tsx` per Section 5, rule 12.
