# DIP-FP-180-adj-1

### Story Summary
Corrects a root-cause bug in FP-180: the Prayer Leader and Food Assignment auto-assign screens only surfaced and round-robinned over events that already had that task assigned, because `event_tasks_assignments` rows are only ever created once someone actually picks an assignee (confirmed directly in `EventForm.tsx`'s own `syncTaskAssignments` comment) — never for a genuinely open slot. This DIP makes both the slot listing and the round-robin RPC driven by every upcoming event, treating a missing row as an open slot eligible for auto-assignment, and adds the create-path (and a defensive uniqueness guard) that requires. Also updates the pre-run confirmation wording to the exact phrasing requested.

### Repo Target
Web (Next.js), `owgc-tech/flockpulse-web`. Same as FP-180 — web-only.

### Grounding Check
- Root cause confirmed by reading `EventForm.tsx` directly (not assumed): `syncTaskAssignments()`'s own comment states a task with no assignee "never gets a row in the first place." My original FP-180 DIP incorrectly inferred a row-per-visible-task always exists — this DIP corrects that inference at the source.
- No conflict with Section 4 invariants — still only touches `event_tasks_assignments.assignee`.
- New data-integrity gap this fix directly creates, and closes in the same migration: once the RPC can `INSERT` (not just `UPDATE`), a missing `(event_id, task_id)` uniqueness guarantee becomes a real risk, not a theoretical one. Adding `CREATE UNIQUE INDEX IF NOT EXISTS idx_event_tasks_assignments_unique_event_task ON event_tasks_assignments(event_id, task_id)` before the function change, and rewriting the RPC to `INSERT ... ON CONFLICT (event_id, task_id) DO UPDATE` — this also simplifies the RPC considerably versus manually branching on "does a row already exist."
- Pre-flight caution, flagged explicitly: this unique index will fail to apply if any duplicate `(event_id, task_id)` rows already exist in the shared `fpdb-dev` database from before this constraint existed. Claude Code cannot check this against remote (per standing rule — Supabase MCP is misconfigured to the wrong org, and CC never applies migrations remotely regardless). User: before running this migration in the Supabase SQL Editor, first run `SELECT event_id, task_id, count(*) FROM event_tasks_assignments GROUP BY event_id, task_id HAVING count(*) > 1;` — if that returns any rows, resolve the duplicates (keep the most recently updated, delete the rest) before applying this migration.
- Cross-tenant safety: the existing `BEFORE INSERT OR UPDATE` trigger on `event_tasks_assignments` (from `task_foundation`) already covers both paths of the new upsert — no trigger changes needed.
- Atomicity unchanged — still one `SECURITY DEFINER` function, one transaction, now via upsert instead of manual branch logic.
- `TaskAutoAssignSlotRow.id` becomes `string | null` — this type is local to the FP-180 feature (not shared with "My Tasks" or any other consumer), so this change has no blast radius outside the four files changed here.

### Implementation Plan

1. **Migration**:
   - Add the unique index (idempotent, `IF NOT EXISTS`).
   - `CREATE OR REPLACE auto_assign_task_slots` — same signature/return shape (no `DROP FUNCTION` needed), now selects every upcoming event for the tenant directly (not via `event_tasks_assignments`), and upserts one row per event via `ON CONFLICT (event_id, task_id) DO UPDATE`.

2. **Repository** (`eventTaskAssignment.repository.ts`) — rewrite `listSlotsForTaskUpcoming`: fetch every tenant event first, filter to `SCHEDULED`/`ACTIVE` via `get_events_effective_statuses`, then fetch this task's existing assignment rows and overlay them onto the event list in JS (LEFT JOIN done in application code, matching the existing fetch-and-reduce convention). Events with no row surface with `id: null`, `assignee: null`.

3. **Types** (`eventTaskAssignment.types.ts`) — `TaskAutoAssignSlotRow.id` becomes `string | null`.

4. **Pages** (`prayer-leader-auto-assign/page.tsx`, `food-assignment-auto-assign/page.tsx`) — both already call `getXAutoAssignData(tenantId)` and discard the returned `task`; now actually use it, passing `taskId={task.id}` down to the panel.

5. **`TaskAutoAssignPanel.tsx`**:
   - Add `taskId: string` prop.
   - Editing state (`editingSlotId`/`savingSlotId`) switches from keying off `slot.id` (can be `null` for multiple rows simultaneously) to keying off `slot.event_id` (always unique, always present).
   - `saveEditSlot`: if the slot's `id` is `null`, `POST /api/event-tasks-assignments` with `{ event_id, task_id: taskId, assignee }` (creates the row); if `id` is present, `PATCH` as before.
   - Confirm-before-run message changed to the exact requested wording: `` `Some Events have a ${taskLabel} assigned already, and will be over written. Would you like to continue?` `` (produces your exact Prayer Leader / Food Assignment phrasing via the existing `taskLabel` prop).
   - Post-run state reconciliation fixed to match returned rows by `event_id` instead of `id` — necessary because previously-row-less slots now have a real `id` for the first time after a run, and matching by the old (`null`) `id` would silently fail to update them locally.

### Files to Create/Modify

| File | Add / Modify |
|---|---|
| `supabase/migrations/20260723000056_auto_assign_upsert_open_events.sql` | New |
| `src/features/tasks/eventTaskAssignment.types.ts` | Modify — `id` type only |
| `src/features/tasks/eventTaskAssignment.repository.ts` | Modify — `listSlotsForTaskUpcoming` rewritten, other four functions untouched |
| `app/admin/(shell)/tasks/prayer-leader-auto-assign/page.tsx` | Modify — pass `taskId` |
| `app/admin/(shell)/tasks/food-assignment-auto-assign/page.tsx` | Modify — pass `taskId` |
| `app/admin/(shell)/tasks/_shared/TaskAutoAssignPanel.tsx` | Modify — `taskId` prop, editing-state rekey, create-vs-update branch, confirm wording, `event_id`-based reconciliation |

### Migration Files

```sql
-- DIP-FP-180-adj-1: root-cause fix — event_tasks_assignments only ever gets a
-- row once someone actually assigns something (EventForm.tsx's own
-- syncTaskAssignments precedent: "an empty core task slot means no assignee,
-- not an assignment row with nobody in it"). The original FP-180 RPC only
-- ever selected existing rows, so it only ever touched already-assigned
-- events — the reverse of the intended behavior. This version drives off
-- every upcoming event directly and upserts.
--
-- PRE-FLIGHT, run manually before applying to fpdb-dev remote (Claude Code
-- cannot check this — Supabase MCP is misconfigured to the wrong org, and CC
-- never applies migrations remotely regardless):
--   SELECT event_id, task_id, count(*) FROM event_tasks_assignments
--   GROUP BY event_id, task_id HAVING count(*) > 1;
-- If this returns any rows, resolve the duplicates before applying — the
-- unique index below will otherwise fail to create.

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_tasks_assignments_unique_event_task
    ON event_tasks_assignments(event_id, task_id);

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
  -- Driven by events directly now, not event_tasks_assignments — an event
  -- with no row yet for this task is still an open slot.
  SELECT array_agg(e.id ORDER BY e.start_datetime ASC, e.id ASC)
  INTO v_event_ids
  FROM events e
  WHERE e.tenant_id = p_tenant_id
    AND public.get_event_effective_status(e.id) IN ('SCHEDULED', 'ACTIVE');

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

-- No explicit GRANT needed — same as the original migration.
```

### Branch Name
`feature/FP-180-adj-1-open-events-round-robin`

### Commit Message
`FP-180-adj-1: include never-assigned events in Prayer Leader/Food Assignment auto-assign round-robin`

### Pull Request Description
- "All future events, assigned or not, should be subject to auto-assignment" → `auto_assign_task_slots` now selects every upcoming event directly and upserts, instead of only updating pre-existing `event_tasks_assignments` rows.
- Slot list on both pages now shows every upcoming event for that task, including ones with no assignee history at all (`id: null` until first assigned).
- Manual edit on a never-before-assigned slot now creates the row (`POST`) instead of erroring or being unreachable.
- Confirm-before-run wording changed to: "Some Events have a [Prayer Leader / Food Assignment] assigned already, and will be over written. Would you like to continue?"
- Also include, in the completion report: confirmation that the pre-flight duplicate-check query was communicated to the user (not run against remote by CC), and the `git diff dev [branch] --` zero-output proof that no other files beyond the six listed above were touched.

### Jira Linkage
- PDEEpicID: FP-11
- PDEStoryID: FP-180

### Stop Point
Save this DIP verbatim to `documentation/dips/DIP-FP-180-adj-1.md` and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against `dev` and stop. Do not merge — the user will check out the branch locally, test it, and merge manually.

Include full diffs for every file in the completion report, and remind the user directly in the PR description about the pre-flight duplicate-check query before they apply this migration to fpdb-dev.
