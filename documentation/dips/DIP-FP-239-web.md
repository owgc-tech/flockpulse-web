### DIP — FP-239 (Web): one event-visibility rule for every event endpoint, Leaders see only their events, Leaders change only events they own

### Not covered — deliberately excluded
- **The setting "Allow assigning tasks to people who are not invited".** It belongs to FP-224, which is revived as its own story. This DIP works whichever way that setting is later turned: an assignee may open the event, and when the setting is off every assignee is an invitee anyway.
- **Reports** (`/api/reports/attendance*`, `/api/reports/rsvp*`). These are scoped by the Leader's assigned members (FP-95), not by event visibility. A Leader's report can name an event the Leader is not invited to, because one of their members was. Unchanged, pending Joseph's decision recorded on FP-239.
- **Leader attendance confirmations** (`/api/confirmations/*`). A Leader confirms the self-reports of their own members for events the Leader may not attend. That is the Leader's pastoral duty under Section 4, rule 1, and not a change to the event. Unchanged.
- **The mobile dashboard** (`/api/reports/dashboard/*`). Non-Admins already see only events they are invited to (`getVisibleEventIds`), which is stricter than this rule. Unchanged.
- **Member actions on their own records** (RSVP, self-report, Commit/Refuse, announcement acknowledgement). Unchanged.
- **The phone.** No mobile change. Every way into the mobile Event Detail (Events tab, My Tasks, Self-Report tab, notifications) leads to an event the caller may open under the new rule. The detail screen keeps "Loading…" forever if a fetch is ever refused; that is filed as FP-244.
- **FP-243** (database tenant check inside the assignee JSON). Separate ticket.

### Story Summary
Three problems, one rule.

First, `GET /api/events/:id` and `GET /api/events/:id/reminder-context` do not check whether the caller may open that event. Neither do the task list for an event, the web roster view, or the announcement acknowledgement roster. Any signed-in member who knows an event id can read it by calling the API directly, outside the apps.

Second, `GET /api/events`, the list behind the web admin Events page, has no role check and no filter. A Member calling it directly gets every event in the community, drafts included. A Leader on the web sees every event, although on the phone they see only events they own or are invited to.

Third, a Leader can add, change or remove task assignments, and run auto-assign, on events they do not own. The phone hides the controls, but the server allows it.

Joseph's decisions, 2026-10-06:
- One rule everywhere, web and phone. **Admin tier** may open any event. **A Leader** may open events they own, are invited to, or currently hold a task on. **A Member** may open events they are invited to or currently hold a task on.
- "Currently hold a task" means resolving as an assignee, directly or through a group, of any task on a non-draft event. It grants the same access as an invitation, roster included. This covers the real case of being asked to bring dessert to an event you are not invited to.
- **Lists** show only owned or invited events. Task-only events open from the task card but do not appear in the Events list, the same as the phone today.
- **Leaders change nothing on an event they do not own:** task assignment create, update and delete, and auto-assign. Event edit, publish and cancel are already owner-scoped.
- **Outside the apps:** an event the caller may not open answers 403 `FORBIDDEN_SCOPE`. An unknown event, or another community's, answers 404 `NOT_FOUND`. A Member calling the web list answers 403 `FORBIDDEN_ROLE`.

### Repo Target
Web (`owgc-tech/flockpulse-web`): API routes, services, the web admin Events list and event page, and one migration. There is no mobile change; the phone keeps working on the new server, as described in the Grounding Check.

### Grounding Check
Verified this session on web `dev` at `8ed62d0` and mobile `dev` at `8ad6830`. **Re-verify every point first. Before changing any code, run the new test's access assertions against unchanged `dev` and record which fail: that is the evidence of the gap. Put the before and after table in the PR.**

**The shared rule today.** `assertCallerCanOpenEvent(tenantId, memberId, role, eventId)` is in `src/features/events/service.ts`, around line 913. It works like this:
- It reads `events(id, owner_member_id)` for the id in the caller's tenant; a missing row throws `NOT_FOUND`.
- It allows the caller when any of these is true:
  - `isAdminTier(role)`;
  - `isLeaderTierOrAbove(role) && owner_member_id === memberId`;
  - `isEventAttendee(...)`, a private helper around line 963 that reads `event_attendees`.
- Otherwise it throws `FORBIDDEN_SCOPE`.

It is used today by:
- `recordEventViewForCaller` (`POST /api/events/:id/view`);
- the default view of `GET /api/events/:id/roster`.

It has no "assigned" clause.

**Routes with no per-event check today:**
- `app/api/events/[id]/route.ts` `GET` (lines 12–31) calls `getEventById(id, ctx.tenantId, ctx.memberId, ctx.role)` directly.
- `app/api/events/[id]/reminder-context/route.ts` (no role, no check) calls `getEventReminderContext(id, ctx.tenantId)`.
- `app/api/event-tasks-assignments/route.ts` `GET` calls `listTaskAssignmentsForEventWithRefusals` with no visibility check.
- The `?view=admin` branch of `app/api/events/[id]/roster/route.ts` is gated by Leader tier only.
- `app/api/announcements/[eventId]/roster/route.ts` `GET` is gated by Leader tier only.

**The web list.**
- `app/api/events/route.ts` `GET` is `withAuth` with **no** `requireRole`. It calls `listEvents(ctx.tenantId, { …, viewer })`.
- `listEvents` (`service.ts` around line 545) queries `events` filtered only by tenant, type, month and status. Drafts are included. `viewer` drives only the Needs attention marker. It selects `LIST_EVENTS_COLS` (line 495), plain columns with no embedding.
- `app/admin/(shell)/events/page.tsx` calls `listEvents` server-side for the first page. `EventsTable.tsx` (line 104) fetches `/api/events` for later pages.

**The web event page.**
- `app/admin/(shell)/events/[id]/page.tsx` allows Leader tier and above, then calls `getEventById(id, tenantId)` with no visibility check.
- `EventDetail.tsx` fetches `/api/events/:id/roster?view=admin` and `/api/event-tasks-assignments?event_id=` client-side.
- The edit page `app/admin/(shell)/events/[id]/edit/page.tsx` already sends a Leader who is not the owner back to the detail page.

**Writes already scoped to the owner.** `PATCH /api/events/:id`, `POST …/publish` and `POST …/cancel` pass `isExactlyLeaderTier(ctx.role) ? ctx.memberId : undefined`, and the service throws `FORBIDDEN_SCOPE` for a non-owner. `convert-to-series`, `event-series`, `reassign-owner` and `bulk-reassign-owner` are Admin only.

**Writes NOT scoped to the owner.**
- `POST /api/event-tasks-assignments`, and `PATCH` and `DELETE /api/event-tasks-assignments/:id`, require Leader tier only. `createTaskAssignment`, `updateTaskAssignment` and `deleteTaskAssignment` (service lines 185–239) never compare the event owner. The `[id]` route maps only `NOT_FOUND`, `VALIDATION_ERROR` and `MEMBER_UNAVAILABLE`.
- `GET /api/tasks/auto-assign/slots` and `POST /api/tasks/auto-assign` require Leader tier only. `listSlotsForTaskUpcoming` (repository around line 203) and `auto_assign_task_slots` (latest definition: migration `20261003000074`, section 5, 5 arguments) cover every upcoming event of the selected types in the tenant. The web auto-assign page allows Leader tier.

**Task assignees need not be invitees.** `validateAssignee` checks tenant, active status and limits only; FP-224 is deferred. So a person can hold a task on an event they are not invited to; Joseph confirmed this happens in real use.

**Mobile, read only, nothing to change.** `getEventById` (`src/features/events/services/events.service.ts`, line 34) is called only by the Event Detail screen. People reach that screen from:
- the Events tab (`/api/events/mine`: owned or invited);
- My Tasks (assigned; `listMyTaskAssignments` returns only SCHEDULED and ACTIVE events, so never drafts);
- the Self-Report tab (invitee);
- notifications (invited events).

`reminder-context` is called for events from `/mine` and from the detail screen. The roster and view calls come from the detail screen. All of these stay allowed.

**Error codes** are the canonical ones: `NOT_FOUND` 404, `FORBIDDEN_SCOPE` 403, `FORBIDDEN_ROLE` 403 (from `requireRole`). No new codes.

**Atlas pre-check of the migration below.** This is inference about your copy, not proof. Atlas applied the SQL to a scratch PostgreSQL 16 database with stand-in tables, plus the real `resolve_assignee_member_ids` and helpers from `20261003000074` and the real previous `auto_assign_task_slots`. Results:
- It applied twice cleanly.
- `is_member_assigned_to_event`: true for a direct assignee and for a group member; false on a draft, for someone outside the group, for another tenant, and for an owner with no task.
- `list_member_visible_events` returns owned (drafts included) plus invited, and nothing for a member with neither.
- `auto_assign_task_slots` with `p_owner_member_id` touched only the owner's events. A call with the old 5 named arguments still resolved and covered every event.
- `anon` and `authenticated` cannot execute any of the three functions; `service_role` can.
- A programmatic diff of the new `auto_assign_task_slots` against the `20261003000074` body shows exactly two changes: the added parameter and the added owner condition.

Atlas will re-run all of this on the real file in review.

**Invariants.**
- Attendance, RSVP and formation logic are not touched (Section 4, rules 1 and 4).
- Tenant always comes from the JWT; every SQL function filters by `p_tenant_id` (rule 3).
- Access is enforced in the API and in service-role-only functions (FP-228).
- No new tables, so no cross-tenant trigger is needed.
- Every response stays the JSON envelope.

### Implementation Plan
1. **Bootstrap.** Save this DIP verbatim to `documentation/dips/DIP-FP-239-web.md`, then create branch `feature/FP-239-web-event-visibility` off current `dev`.

2. **Evidence first.** Write `scripts/test-fp239-event-visibility.ts` (step 10), run its access section against unchanged `dev`, and keep the output for the PR.

3. **Migration.** Write `supabase/migrations/20261006000082_event_visibility_and_leader_scope.sql` exactly as in "Migration Files" below. Confirm `082` is the next free number. Validate with `supabase db reset`.

4. **The shared rule** (`src/features/events/service.ts`).
   - In `assertCallerCanOpenEvent`, add the assigned clause after the attendee check: `|| (await isMemberAssignedToEvent(tenantId, eventId, memberId))`, calling the new RPC `is_member_assigned_to_event`. Keep the order cheap-first: Admin, then owner (Leader tier), then attendee, then assigned. Stop at the first match.
   - Update the function's comment so it states the full rule. Remove the "GET /api/events/:id itself has no per-event check — FP-239" remark.
   - Export a non-throwing twin, `canCallerOpenEvent(...)`, that returns `'OK' | 'NOT_FOUND' | 'FORBIDDEN_SCOPE'` and is built on the same code, for the web page.
   - Add the repository/RPC wrapper next to the other event RPCs.

5. **Read endpoints.** Each one calls `assertCallerCanOpenEvent(ctx.tenantId, ctx.memberId, ctx.role, id)` **before** any other read, and maps `NOT_FOUND` to 404 and `FORBIDDEN_SCOPE` to 403.
   - `GET /api/events/:id`.
   - `GET /api/events/:id/reminder-context`. Update its header comment, which still says "No role restriction, matching GET /api/events/:id's existing precedent".
   - `GET /api/event-tasks-assignments?event_id=`. The check goes before `listTaskAssignmentsForEventWithRefusals`. A missing `event_id` is still 400.
   - `GET /api/events/:id/roster?view=admin`. The check goes inside the existing Leader-tier branch, before `getEventRoster`. Everything else about that view (Leader scoped to their own members, removed members included, no redaction) is unchanged.
   - `GET /api/announcements/:eventId/roster`. The check goes inside the existing Leader-tier gate.
   - `POST /api/events/:id/view` and the default roster view already call the function, so they pick up the assigned clause automatically. Do not change those routes.
   - Internal callers of `getEventById` that pass no caller (`cancelEvent`, `convert-to-series`, the PATCH address check, the edit page) are unchanged.

6. **The web list.**
   - `GET /api/events` is wrapped in `requireRole('LEADER')`, so a Member gets 403 `FORBIDDEN_ROLE`.
   - Add `visibleTo?: { memberId: string; role: Role }` to `ListEventsOptions`. When `visibleTo` is a Leader-tier caller (`isExactlyLeaderTier`), `listEvents` reads from `db.rpc('list_member_visible_events', { p_tenant_id, p_member_id }, { count: 'exact' }).select(LIST_EVENTS_COLS)` instead of `db.from('events').select(LIST_EVENTS_COLS, { count: 'exact' })`. Apply the same tenant, type, month, order, range and status steps to it. Admin tier and no `visibleTo` keep today's query.
   - Both list paths (with and without a status filter) must work.
   - **Verify this locally:** a set-returning RPC taking `.eq`, `.in`, `.gte`, `.lt`, `.order`, `.range` and `count: 'exact'` through supabase-js. If any part does not work, stop and report before using a fallback. The approved fallback is: first fetch the visible ids with one RPC, then `.in('id', ids)`. Only use it if you also show it stays correct with 500 ids.
   - Pass `visibleTo: { memberId: ctx.memberId, role: ctx.role }` from `GET /api/events`, and `visibleTo` from `app/admin/(shell)/events/page.tsx` (which has `memberId` and `role`; if `memberId` is missing for a non-Admin, redirect to `/login`, matching the page's existing guard style).

7. **The web event page** (`app/admin/(shell)/events/[id]/page.tsx`). After the existing auth guard, call `canCallerOpenEvent(tenantId, memberId, role, id)`. Anything but `'OK'` goes to `redirect('/admin/events')`, the same as an unknown event today. The page needs `memberId`; it already reads it.

8. **Leader writes scoped to the owner.**
   - `createTaskAssignment`, `updateTaskAssignment` and `deleteTaskAssignment` gain a trailing optional `scopeToOwnerMemberId?: string`, the same pattern as `updateEvent`, `publishEvent` and `cancelEvent`.
     - When set, read the event's `owner_member_id`: create uses `input.eventId`; update and delete use the existing assignment's `event_id`, read before any write.
     - If the owner is not the caller, throw `FORBIDDEN_SCOPE` with the message "You may only change tasks on events you own".
     - Do this before validation and before any write, so nothing changes.
   - The routes pass `isExactlyLeaderTier(ctx.role) ? ctx.memberId : undefined`. Map `FORBIDDEN_SCOPE` to 403 in `POST`, `PATCH` and `DELETE`; today the `[id]` route does not map it.
   - Auto-assign:
     - `getTaskAutoAssignData` and `listSlotsForTaskUpcoming` gain an optional `ownerMemberId`; when set, add `.eq('owner_member_id', ownerMemberId)` to the events query.
     - `runTaskAutoAssign` and `runAutoAssignTaskSlots` gain the same parameter and pass it as `p_owner_member_id` to the RPC.
     - Both auto-assign routes pass `isExactlyLeaderTier(ctx.role) ? ctx.memberId : undefined`.
     - `readEventVersionsBestEffort` may keep its current scope (it only detects which events changed).
     - The slot list a Leader sees and the events the run changes must be the same set.
   - Mobile Edit, web Edit and web auto-assign need no UI change. The owner already passes, and a Leader's auto-assign panel now simply lists their own events.

9. **Comments.** Wherever a comment states the old behavior, update it to the new one: the list route, `listEvents`, the reminder-context header, and `assertCallerCanOpenEvent`.

10. **Tests.** New `scripts/test-fp239-event-visibility.ts` (force-add; `npx tsx`; local database after `supabase db reset`; real route handlers with real JWTs, the same style as `test-fp240-roster-visibility.ts`).
    - **Fixtures:** two tenants. In tenant 1: an Admin; Leader A (owns E1 and a draft D1); Leader B (invited to E2 only); Leader C (no relation, but in group G, which holds a task on E3); Member M1 (invited to E2); Member M2 (direct assignee on E3, not invited); Member M3 (assigned on draft D2 only); Member M4 (no relation). In tenant 2: one event.
    - **Read endpoints:** for every caller and event, check `GET /api/events/:id`, `reminder-context`, the roster (default view, and `?view=admin` for the Leader tier), `POST view`, `GET /api/event-tasks-assignments?event_id=`, and the announcement roster (use an announcement event). Expected: allowed means 200; not allowed means 403 `FORBIDDEN_SCOPE`; another tenant's event or an unknown id means 404 `NOT_FOUND`. Print the full matrix.
    - **Lists:**
      - `GET /api/events`: a Member gets 403 `FORBIDDEN_ROLE`; Leader A sees exactly E1 and D1; Leader B sees exactly E2; Leader C sees nothing (task-only, by design); the Admin sees everything.
      - Check both the no-status and the status-filter paths, plus pagination with `hasMore`.
      - Call `listEvents` with `visibleTo` the way the server page does, with the same result.
    - **The page helper:** `canCallerOpenEvent` returns `'OK'`, `'FORBIDDEN_SCOPE'` and `'NOT_FOUND'` in the expected cases.
    - **Writes:**
      - Leader B (not owner) on E2: POST, PATCH and DELETE of a task assignment each give 403, and the row and `events.version` are unchanged.
      - Leader A on E1 succeeds. The Admin on E2 succeeds.
      - Auto-assign: Leader A's slots list only E1 and D1, and the run changes only those (other events' assignments and versions untouched). The Admin's run covers every eligible event.
    - **SQL:**
      - the privileges of the three functions (`service_role` only);
      - `is_member_assigned_to_event` agrees with `resolve_assignee_member_ids` for every fixture (member × event);
      - applying the migration twice is clean.
    - **Regression:** also run `test-fp222-adj1-what-changed.ts`, `test-fp222-indicator-flags.ts`, `test-fp240-roster-visibility.ts`, `test-fp242-assignee-states.ts`, and every other script in `scripts/` that touches events or tasks. Report each result against its baseline; any changed expectation must be explained.

11. **Checks.** Run `npx tsc --noEmit`, then eslint on the changed files. Commit, push, and run `gh pr create --base dev`.

### Files to Create/Modify
- Create:
  - `documentation/dips/DIP-FP-239-web.md` (verbatim, then frozen)
  - `supabase/migrations/20261006000082_event_visibility_and_leader_scope.sql`
  - `scripts/test-fp239-event-visibility.ts` (force-add)
- Modify:
  - `src/features/events/service.ts`, plus the events repository file if that is where RPC wrappers live (say which)
  - `app/api/events/route.ts`
  - `app/api/events/[id]/route.ts`
  - `app/api/events/[id]/reminder-context/route.ts`
  - `app/api/events/[id]/roster/route.ts`
  - `app/api/announcements/[eventId]/roster/route.ts`
  - `app/api/event-tasks-assignments/route.ts`
  - `app/api/event-tasks-assignments/[id]/route.ts`
  - `src/features/tasks/eventTaskAssignment.service.ts`
  - `src/features/tasks/eventTaskAssignment.repository.ts`
  - `src/features/tasks/autoAssign.service.ts`
  - `app/api/tasks/auto-assign/route.ts`
  - `app/api/tasks/auto-assign/slots/route.ts`
  - `app/admin/(shell)/events/page.tsx`
  - `app/admin/(shell)/events/[id]/page.tsx`
- Must stay untouched. Show `git diff dev feature/FP-239-web-event-visibility -- <file>` with zero output for each:
  - `app/api/events/[id]/view/route.ts`
  - `app/api/events/mine/route.ts`
  - `app/api/events/[id]/publish/route.ts`
  - `app/api/events/[id]/cancel/route.ts`
  - every file under `app/api/reports/` and `app/api/confirmations/`
  - `src/features/tasks/refusedTasks.ts`
  - `src/features/tasks/assigneeStates.ts`
  - every existing migration

### Migration Files (if applicable)
`supabase/migrations/20261006000082_event_visibility_and_leader_scope.sql`. Written to disk and validated locally; **never applied to a remote database by Claude Code**. Copy it exactly:

```sql
-- DIP-FP-239-web: event visibility and Leader write scope.
--   1. is_member_assigned_to_event(): does a member currently resolve as an
--      assignee of any task on this (non-draft) event — the "assigned" clause
--      of the shared can-open rule (assertCallerCanOpenEvent).
--   2. list_member_visible_events(): the events a Leader-tier caller may see in
--      the web admin Events list — owned or invited (same set as the mobile
--      Events tab before its date/status trimming). Returned as rows so the
--      API can embed, filter, order and page them like a plain events query.
--   3. auto_assign_task_slots(): adds p_owner_member_id (DEFAULT NULL = no
--      scope, Admin tier). A Leader's auto-assign only touches events they own.
--      The 5-argument version is dropped; old code calling with 5 named
--      arguments still resolves to the new function through the default.
-- Idempotent. Apply it as one script (paste the whole file and run once), so
-- the DROP and the CREATE of auto_assign_task_slots go in together.

-- 1 ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_member_assigned_to_event(
  p_tenant_id UUID, p_event_id UUID, p_member_id UUID
)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1
    FROM event_tasks_assignments eta
    JOIN events e ON e.id = eta.event_id AND e.tenant_id = p_tenant_id
    WHERE eta.tenant_id = p_tenant_id
      AND eta.event_id = p_event_id
      AND e.status <> 'DRAFT'
      AND EXISTS (
        SELECT 1 FROM public.resolve_assignee_member_ids(p_tenant_id, eta.assignee) r
        WHERE r.member_id = p_member_id
      )
  )
$$;

REVOKE EXECUTE ON FUNCTION public.is_member_assigned_to_event(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_member_assigned_to_event(UUID, UUID, UUID) TO service_role;

-- 2 ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_member_visible_events(p_tenant_id UUID, p_member_id UUID)
RETURNS SETOF events LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT e.*
  FROM events e
  WHERE e.tenant_id = p_tenant_id
    AND (
      e.owner_member_id = p_member_id
      OR EXISTS (
        SELECT 1 FROM event_attendees ea
        WHERE ea.tenant_id = p_tenant_id AND ea.event_id = e.id AND ea.member_id = p_member_id
      )
    )
$$;

REVOKE EXECUTE ON FUNCTION public.list_member_visible_events(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_member_visible_events(UUID, UUID) TO service_role;

-- 3 ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.auto_assign_task_slots(UUID, UUID, JSONB, UUID, UUID[]);

CREATE OR REPLACE FUNCTION public.auto_assign_task_slots(
    p_tenant_id UUID,
    p_task_id UUID,
    p_roster JSONB,
    p_actor_member_id UUID,
    p_event_type_ids UUID[],
    p_owner_member_id UUID DEFAULT NULL
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
  v_had_row BOOLEAN;
  v_old_assignee JSONB;
  i INT;
BEGIN
  SET LOCAL app.skip_unavailability_check = 'true';

  IF p_event_type_ids IS NULL OR array_length(p_event_type_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  SELECT array_agg(e.id ORDER BY e.start_datetime ASC, e.id ASC)
  INTO v_event_ids
  FROM events e
  WHERE e.tenant_id = p_tenant_id
    AND e.event_type_id = ANY(p_event_type_ids)
    AND e.end_datetime >= now()
    AND public.get_event_effective_status(e.id) IN ('DRAFT', 'SCHEDULED', 'ACTIVE')
    AND (p_owner_member_id IS NULL OR e.owner_member_id = p_owner_member_id);

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

    SELECT assignee INTO v_old_assignee
    FROM event_tasks_assignments
    WHERE event_id = v_event_ids[i] AND task_id = p_task_id;
    v_had_row := FOUND;

    INSERT INTO event_tasks_assignments (tenant_id, event_id, task_id, assignee)
    VALUES (p_tenant_id, v_event_ids[i], p_task_id, v_new_assignee)
    ON CONFLICT (event_id, task_id)
    DO UPDATE SET assignee = EXCLUDED.assignee, updated_at = now()
    RETURNING * INTO v_row;

    IF NOT v_had_row OR v_old_assignee IS DISTINCT FROM v_new_assignee THEN
      PERFORM public.clear_responses_for_removed_assignees(p_tenant_id, v_row.id, v_row.assignee);
      PERFORM public.bump_event_version_for_task_change(p_tenant_id, v_row.event_id);
    END IF;

    RETURN NEXT v_row;
  END LOOP;

  RETURN;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.auto_assign_task_slots(UUID, UUID, JSONB, UUID, UUID[], UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_assign_task_slots(UUID, UUID, JSONB, UUID, UUID[], UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
```

**Order for Joseph:** apply this migration in the Supabase SQL Editor **before** merging, because the new code calls all three functions. Applying it early is safe: the old code still works, because a 5-argument auto-assign call resolves to the new function through the default.

Verification query. It should return three rows, each `false | false | true`, and exactly one auto-assign function (the 6-argument one):

```sql
SELECT p.oid::regprocedure AS fn,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_can
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('is_member_assigned_to_event', 'list_member_visible_events', 'auto_assign_task_slots')
ORDER BY 1;
```

### Branch Name
feature/FP-239-web-event-visibility

### Commit Message
FP-239-web: one event-visibility rule for every event endpoint; Leaders see and change only their own events

### Pull Request Description
Plain GitHub markdown. Include the following.

**Summary.** Include the migration-order note: apply `20261006000082` before merging, with the verification query.

**Before and after.** The access matrix from unchanged `dev` (which proves the gap) next to the matrix from this branch.

**Acceptance criteria → behavior**, one line each, with evidence:
- the detail and every sub-route follow one rule;
- a Member cannot list events;
- a Leader lists only owned or invited events;
- a Leader is sent away from an event page they cannot open;
- a task assignee opens the event;
- a Leader cannot change tasks or run auto-assign on events they do not own;
- an Admin is unchanged;
- 404 versus 403 behave as specified.

**Unchanged on purpose.** Reports, confirmations, the dashboard, `/mine`, publish and cancel, each with its zero-output diff.

**The supabase-js check** from step 6: the result of the RPC list query, or why the fallback was used.

**Deviations from this DIP**, with reasons, including any grounding claim that turned out wrong.

**Not tested.** The hosted database, a real browser, real phones, and concurrency.

**Manual steps for Joseph**, after the migration, the merge and Vercel Ready:
1. Web, signed in as a Leader: the Events list shows only events you own or are invited to.
2. Paste the address of another event (one you neither own nor are invited to) into the browser. You should land back on the Events list.
3. Web, as Admin: every event is listed, exactly as before.
4. Phone, as a Member who holds a task on an event they are not invited to: tap the task card in My Tasks. The event detail opens, and the event does not appear in the Events tab.
5. Phone, as a Leader: Events, the detail screen, the roster and Tasks all work as before for your own events.
6. Web auto-assign, as a Leader: only your own events are listed and changed.

### Jira Linkage
- PDEEpicID: FP-8
- PDEStoryID: FP-239

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-239-web.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Branch off current dev and open the PR with gh pr create --base dev; quote the base in your report and do NOT stack it on any other branch. Do not apply any migration to a remote database and do not merge: Joseph applies migrations after review, tests, and merges manually.

Include full diffs for every file in your completion report per Section 5, rule 13, not a summary.
