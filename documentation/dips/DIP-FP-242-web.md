### DIP — FP-242 (Web): assignee states on the task list API and colored assignee pills on the web event page

### Not covered — deliberately excluded
- **The mobile half of FP-242** (pills on the mobile Event Detail). That is a separate DIP for CC-mobile. It is sent only after this PR is merged, its migration is applied, and Vercel shows the deployment Ready on `preview.flockpulse.ca`.
- **Removing `refused_by`.** It stays on every row with the same shape, so older phone builds keep working. A later ticket removes it once every phone runs the pill build.
- **The Needs Attention strip, `needs_attention`, `needs_attention_tasks`, `listRefusedTaskNamesByEvent` (`src/features/tasks/refusedTasks.ts`), the web events list marker, reports, the Tasks tab and `/api/event-tasks-assignments/mine`.** All stay unchanged.
- **FP-239.** `GET /api/event-tasks-assignments` has no per-event visibility check today. FP-239 handles that. This DIP does not add or change that check.
- **Collapsing groups or lowering the 100 cap.** Joseph decides that after he sees the real result on a device.
- **Showing response states to anyone except the event owner and Admin tier.** That would be a privacy change and is out of scope.

### Story Summary
For the event owner and Admin tier, each task's assignees should show as one pill per person: green with a check mark when committed, red with a cross mark when refused, grey with just the name when they have not answered. No state words appear on screen, but screen readers announce the state. This replaces the red "Refused: Name" line.

A task assigned to a group shows one pill per current group member, under a small neutral caption with the group's name. If a task would show more than 100 pills, the first 100 are shown, followed by a neutral "+N more" pill.

This web DIP does three things:
1. Adds the server data (`assignee_states`) to `GET /api/event-tasks-assignments?event_id=X`, filled only for the owner and Admin tier.
2. Computes the data in one new database function, so there is a constant number of queries and the same group-resolution rule as `resolve_assignee_member_ids`.
3. Replaces the "Refused" line on the web event page with the pills.

Everyone else sees the task rows exactly as today.

### Repo Target
Web (`owgc-tech/flockpulse-web`): the API route, the service, a new SQL function (migration), and the web admin event page. The mobile DIP depends on this one being merged and deployed.

### Grounding Check
Verified this session on `dev` at `37b165f` (merge of PR 224). **Re-verify each point before changing anything, and report any difference in the PR description.**

- **Route.** `app/api/event-tasks-assignments/route.ts`, `GET` (lines 12–22). Any authenticated tenant member can call it. It returns `{ data: listTaskAssignmentsForEventWithRefusals(eventId, ctx.tenantId, { memberId: ctx.memberId, role: ctx.role }) }` in the JSON envelope.
- **Service.** `src/features/tasks/eventTaskAssignment.service.ts`:
  - `listTaskAssignmentsForEventWithRefusals` (about lines 313–340) loads the rows, then decides `canManage = isAdminTier(caller.role)`. Otherwise it reads `events.owner_member_id` and compares it with `caller.memberId`. Non-managers get `refused_by: []` and the refusals are never read. Managers get `refused_by` from `listOutstandingRefusalsForEvent`.
  - `listOutstandingRefusalsForEvent` (about lines 274–299) calls `resolveAssigneeMemberIds` **once per assignment that has a refusal** (an RPC each, so N queries). It is replaced by this DIP.
- **Repository.** `src/features/tasks/eventTaskAssignment.repository.ts`:
  - `listEventTaskAssignmentsForEvent` (line 67).
  - `listCurrentRefusedResponsesForEvent` (line 125).
  - `resolveAssigneeMemberIds` (line 155, RPC `resolve_assignee_member_ids`).
- **Types.** `src/features/tasks/eventTaskAssignment.types.ts`: `OutstandingRefusal` (line 36), `RefusedBy` (line 45) and `EventTaskAssignmentWithRefusals extends EventTaskAssignmentRow { refused_by: RefusedBy[] }` (line 54).
- **Web event page, server side.** `app/admin/(shell)/events/[id]/page.tsx` line 43: `canManage = isAdminTier(role) || event.owner_member_id === memberId`. Line 47 calls `listOutstandingRefusalsForEvent` on the server and passes `outstandingRefusals` to `EventDetail`.
- **Web event page, client side.** `app/admin/(shell)/events/[id]/EventDetail.tsx`:
  - It already **fetches `/api/event-tasks-assignments?event_id=` itself** (line 78) into `taskAssignments`, typed `EventTaskAssignmentRow[]` (line 61).
  - The Tasks section (lines 264–290) renders comma-joined group names and member names (`groupById` and `memberById` from the `groups` and `members` props). It then renders `Refused: {names}` in `font-bold text-red-600 dark:text-red-400` from the `outstandingRefusals` prop.
- **Grounding correction to the ticket.** FP-242 says "the web event page computes the same list on the server". The page already gets its task rows from the endpoint, and the endpoint applies the same `canManage` rule on the server. So the page will read `assignee_states` from the endpoint: one source of truth, still gated server-side. The server-side `listOutstandingRefusalsForEvent` call in `page.tsx` is removed. Nothing about who can see what changes.
- **Consumers of the code being removed.** `listOutstandingRefusalsForEvent` is used only by the service and `page.tsx`. `listCurrentRefusedResponsesForEvent` is used only by `listOutstandingRefusalsForEvent`. `OutstandingRefusal` is used only by the service and `EventDetail.tsx`. This was checked with an unlimited grep. Repeat that grep over `app/`, `src/` and `scripts/`, then delete all three only if nothing else uses them.
- **Group resolution rule.**
  - `resolve_assignee_member_ids` (migration `20261003000074`, section 1) returns the direct `member_ids` UNION members of the listed groups from `assignments` where `assignment_type = 'GROUP'`, `deleted_at IS NULL` and the tenant matches.
  - It does **not** check `members.deleted_at` or the member's tenant for direct ids. The new function adds both checks, so removed members and foreign ids never appear.
  - The rule is also mirrored in TypeScript in `refusedTasks.ts` and in `listMyTaskAssignments`. Those are not touched.
- **Responses.** `event_task_assignment_responses` (migration `20261003000073`) has `status IN ('COMMITTED','REFUSED')` and `is_current`, plus the unique index `idx_etar_one_current_per_member ON (assignment_id, member_id) WHERE is_current`, so there is at most one current answer per person per assignment. "Not yet responded" means no current row.
- **Everyone group.** The system group "Everyone" (migration `20260727000061`) has real `assignments` GROUP rows for every member, so it expands like any group. It can be hundreds of people, which is why the result is returned as a single `jsonb` value. Returning one row per pill would hit PostgREST's row limit (1000 by default on hosted Supabase) and the URL length of large `.in()` lists.
- **Migrations.** The newest is `20261005000080_event_member_views.sql`. The next free number is `20261006000081`; confirm it.
- **Styling.** Tailwind v4 (`tailwindcss ^4`), so `sr-only` is available. No icon library is installed, so use the text glyphs ✓ and ✕ (or a tiny inline SVG) with `aria-hidden="true"`.
- **Existing tests.** `scripts/test-fp222-adj1-what-changed.ts` asserts `refused_by` (owner and Admin only) and already has a fetch-counting pattern for query counts (around lines 265–276). It must still pass unchanged.
- **Atlas pre-check (inference, not proof that your copy is right).** Atlas applied the SQL below to a scratch PostgreSQL 16 database with stand-in tables matching the real column definitions, plus the real `resolve_assignee_member_ids`:
  - It applied twice cleanly.
  - It returned the expected states. A direct assignment wins over a group. A person in two groups appears once, under the first group listed. A member removed from a group and a member with `deleted_at` set are excluded. A cleared refusal shows as PENDING. A foreign-tenant id in `member_ids` is excluded.
  - It returned `[]` for another tenant or an unknown event.
  - It matched `resolve_assignee_member_ids` minus removed members exactly: 0 extra, 0 missing.
  - Only `service_role` can execute it.
  - Atlas will re-run this on the real migration in review.
- **Invariants.**
  - No attendance or formation table is touched (Section 4, rules 1 and 4).
  - No naming constraint is involved (rule 2).
  - Tenant comes from the JWT (`ctx.tenantId`), and the function filters every table by `p_tenant_id` (rule 3).
  - Commit/Refuse history is only read, never written (rule 6).
  - No new table, so no cross-tenant trigger is needed.
  - The function is read-only, `SECURITY DEFINER`, closed to PUBLIC, `anon` and `authenticated`, and granted to `service_role` only (FP-228).
  - No new error codes.
  - The response stays the JSON envelope.

### Implementation Plan
1. **Bootstrap.** Save this DIP verbatim to `documentation/dips/DIP-FP-242-web.md`. Branch `feature/FP-242-web-assignee-pills` off current `dev`.
2. **Migration.** Write `supabase/migrations/20261006000081_task_assignee_states.sql` exactly as in "Migration Files" below, adjusting only the number if it is taken. Validate with `supabase db reset`.
3. **Types** (`eventTaskAssignment.types.ts`):
   - Add `export type AssigneeState = 'COMMITTED' | 'REFUSED' | 'PENDING';`.
   - Add `export interface AssigneeStateEntry { member_id: string; name: string; state: AssigneeState; via_group_id: string | null; }`.
   - Extend `EventTaskAssignmentWithRefusals` with `assignee_states: AssigneeStateEntry[]` (display order, at most 100) and `assignee_states_total: number` (the uncapped count).
   - Update the comment so it says both new fields are filled only for the owner and Admin tier, and are `[]` and `0` for everyone else.
   - Remove `OutstandingRefusal` if the grep shows no other consumer.
4. **Pure helper.** New file `src/features/tasks/assigneeStates.ts`, with no I/O, so it can be tested directly:
   - `export const ASSIGNEE_PILL_CAP = 100;`
   - `orderAssigneeStates(entries, assignee)`: sections are direct members (`via_group_id === null`) first, then groups in the order of `assignee.group_ids`. Within each section, order is REFUSED, then PENDING, then COMMITTED, then `name` (`localeCompare`), then `member_id` as a tie-break. Returns a new array.
   - `capAssigneeStates(ordered, cap = ASSIGNEE_PILL_CAP)` returns `{ shown, total }`.
   - `refusedByFromStates(entries)` returns `RefusedBy[]`: every REFUSED entry from the **uncapped** list, sorted by name, as `{ member_id, name }`.
   - Comment: refused people sort first within their section so they are least likely to fall behind the cap. Past 100 pills, the Needs Attention strip still flags any refusal.
5. **Repository.** Add `listAssigneeStatesForEvent(tenantId, eventId): Promise<(AssigneeStateEntry & { assignment_id: string })[]>`. It calls `rpc('list_event_task_assignee_states', { p_tenant_id, p_event_id })` and returns the parsed array (`[]` when null). Remove `listCurrentRefusedResponsesForEvent` if nothing else uses it.
6. **Service.** In `listTaskAssignmentsForEventWithRefusals`:
   - Keep the rows query and the `canManage` decision exactly as they are.
   - Non-managers: every row gets `refused_by: []`, `assignee_states: []`, `assignee_states_total: 0`, and the RPC is **not** called.
   - Managers: call `listAssigneeStatesForEvent` **once**, group the entries by `assignment_id`, and for each row:
     - `ordered = orderAssigneeStates(entries, row.assignee)`;
     - `{ shown, total } = capAssigneeStates(ordered)`;
     - `refused_by = refusedByFromStates(ordered)`.
   - Remove `listOutstandingRefusalsForEvent` if nothing else uses it.
   - Query count: one rows query, plus one owner lookup for non-Admins, plus one RPC. That is constant however many tasks or members. Do not add per-task or per-member calls.
7. **Web page, server** (`app/admin/(shell)/events/[id]/page.tsx`). Remove the `listOutstandingRefusalsForEvent` import and call, and the `outstandingRefusals` prop. Keep `canManage` exactly as it is.
8. **Web page, client** (`EventDetail.tsx`):
   - Type `taskAssignments` as `EventTaskAssignmentWithRefusals[]` and remove the `outstandingRefusals` prop.
   - When `canManage` is **false**: render today's markup byte-for-byte (the comma-joined names, no pills).
   - When `canManage` is **true**: render a new `AssigneePills` component instead of the names line and the Refused line. Give that task's `<div>` `col-span-2`, so long pill lists use the full width (managers only; state this in the PR).
   - `AssigneePills` lives in a new file `app/admin/(shell)/events/[id]/AssigneePills.tsx`. It receives the row and `groupById`, and renders:
     - The direct section (no caption), then one section per group id in `assignee.group_ids` order that has at least one shown entry. Each group section has a small neutral caption (`text-xs text-zinc-500 dark:text-zinc-400`) with the group's name (`'Unknown group'` fallback).
     - Each section is a `<ul role="list" className="flex flex-wrap gap-1.5">` of `<li>` pills: `rounded-full px-2.5 py-0.5 text-xs font-medium` with a 1px border.
     - Committed: green background, ✓ before the name.
     - Refused: red background, ✕ before the name.
     - Pending: grey background, name only.
     - The mark is `aria-hidden="true"`. Each pill ends with `<span className="sr-only">, committed</span>`, `, refused` or `, not yet responded`. No state word is visible.
     - When `assignee_states_total > assignee_states.length`: a final neutral pill `+N more` (N = total minus shown) with an sr-only `more assignees`.
     - When `assignee_states_total === 0`: `—`, as today.
   - Pick the green, red and grey classes for light and dark mode so that **every text-on-background pair is at least 4.5:1**. Suggested starting point:
     - Light: `bg-green-100 text-green-900 border-green-300`, `bg-red-100 text-red-900 border-red-300`, `bg-zinc-100 text-zinc-800 border-zinc-300`.
     - Dark: `bg-green-950 text-green-200 border-green-800`, `bg-red-950 text-red-200 border-red-800`, `bg-zinc-800 text-zinc-100 border-zinc-700`.
   - Measure, don't assume: compute WCAG contrast ratios from the real Tailwind v4 color values in `node_modules/tailwindcss/theme.css` (oklch converted to sRGB) with a small script. Put the six ratios in the PR.
9. **Tests.** New `scripts/test-fp242-assignee-states.ts` (force-add; `npx tsx`; local database after `supabase db reset`; same setup style as `test-fp222-adj1-what-changed.ts`). Cover:
   - **Pure helper:** section order; state order; name order; cap at 100 (a 150-member set gives 100 shown, total 150); refused people from beyond the cap still listed in `refused_by`; an empty assignee; `null` assignee.
   - **SQL function and service against the local database:**
     - direct, group, and both;
     - one person in two groups (appears once, under the first group);
     - a member removed from a group (`assignments.deleted_at`);
     - a removed member (`removeMember`), who must disappear;
     - Commit, then Refuse, then Commit: the pill follows each change after a reload;
     - replacing a person through `updateTaskAssignment`: the old pill disappears, the new person is PENDING;
     - a cleared refusal shows PENDING;
     - another tenant's event returns `[]`;
     - an Everyone-sized group (create at least 150 members) returns all states in one call.
   - **Equivalence:** for every assignment in the fixtures, the set of `member_id`s equals `resolve_assignee_member_ids(...)` minus members with `deleted_at` set.
   - **Endpoint gating with real JWTs:**
     - Admin and the owner (a Leader) receive the states and `refused_by`;
     - a non-owner Leader, a plain Member, and the refusing member themselves receive `assignee_states: []`, `assignee_states_total: 0`, `refused_by: []`;
     - the response is the `{ data }` envelope.
   - **Query count** (fetch-counting pattern): the same number of database calls for an event with 1 task and 1 member as for one with 10 tasks and 150 members.
   - **Privileges:** `anon` and `authenticated` cannot execute the function; `service_role` can.
   - **Regression:** also run `test-fp222-adj1-what-changed.ts`, `test-fp222-indicator-flags.ts` and `test-fp240-roster-visibility.ts`. Report all four results.
10. **Checks.** Run `npx tsc --noEmit` and `npm run lint` on the changed files. Commit, push, and run `gh pr create --base dev`.

### Files to Create/Modify
- Create `documentation/dips/DIP-FP-242-web.md` (verbatim, then frozen)
- Create `supabase/migrations/20261006000081_task_assignee_states.sql`
- Create `src/features/tasks/assigneeStates.ts`
- Create `app/admin/(shell)/events/[id]/AssigneePills.tsx`
- Create `scripts/test-fp242-assignee-states.ts` (force-add)
- Modify `src/features/tasks/eventTaskAssignment.types.ts`
- Modify `src/features/tasks/eventTaskAssignment.repository.ts`
- Modify `src/features/tasks/eventTaskAssignment.service.ts`
- Modify `app/admin/(shell)/events/[id]/page.tsx`
- Modify `app/admin/(shell)/events/[id]/EventDetail.tsx`
- Must stay untouched (show `git diff dev feature/FP-242-web-assignee-pills -- <file>` with zero output):
  - `src/features/tasks/refusedTasks.ts`
  - `app/api/event-tasks-assignments/route.ts` (the service change is enough; if you do need to touch it, explain why)
  - `app/api/event-tasks-assignments/mine/route.ts`
  - every existing migration
  - `src/features/events/service.ts`

### Migration Files (if applicable)
`supabase/migrations/20261006000081_task_assignee_states.sql`, written to disk, validated locally with `supabase db reset`, **never applied to a remote database by Claude Code**:

```sql
-- DIP-FP-242-web: for every task assignment on one event, the people it resolves
-- to and each person's CURRENT response (COMMITTED / REFUSED / PENDING = no current
-- response). Read-only. One call per event, returned as a single JSONB array so a
-- large group (Everyone) never hits PostgREST's row limit.
--
-- Resolution matches resolve_assignee_member_ids() (20261003000074): direct
-- member_ids UNION members of the listed groups (assignments, assignment_type
-- 'GROUP', deleted_at IS NULL, same tenant) — plus two filters it does not apply:
-- the member must belong to p_tenant_id and must not be removed (members.deleted_at).
-- A person reached both directly and through a group is reported as direct
-- (via_group_id NULL); a person in several listed groups is reported once, under
-- the first group in assignee.group_ids order.
--
-- KEEP IN SYNC with resolve_assignee_member_ids(), listRefusedTaskNamesByEvent()
-- (src/features/tasks/refusedTasks.ts) and listMyTaskAssignments(). A test asserts
-- this function and resolve_assignee_member_ids() never disagree.

CREATE OR REPLACE FUNCTION public.list_event_task_assignee_states(p_tenant_id UUID, p_event_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  WITH a AS (
    SELECT eta.id AS assignment_id, eta.assignee
    FROM event_tasks_assignments eta
    WHERE eta.tenant_id = p_tenant_id AND eta.event_id = p_event_id
  ),
  candidates AS (
    SELECT a.assignment_id, (d.v)::uuid AS member_id, NULL::uuid AS via_group_id, 0::bigint AS pos
    FROM a CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(a.assignee->'member_ids', '[]'::jsonb)) AS d(v)
    UNION ALL
    SELECT a.assignment_id, asg.member_id, (g.v)::uuid, g.ord
    FROM a
    CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(a.assignee->'group_ids', '[]'::jsonb)) WITH ORDINALITY AS g(v, ord)
    JOIN assignments asg
      ON asg.tenant_id = p_tenant_id AND asg.assignment_type = 'GROUP' AND asg.deleted_at IS NULL
     AND asg.group_id = (g.v)::uuid
  ),
  resolved AS (
    SELECT DISTINCT ON (c.assignment_id, c.member_id) c.assignment_id, c.member_id, c.via_group_id
    FROM candidates c
    ORDER BY c.assignment_id, c.member_id, c.pos
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'assignment_id', r.assignment_id,
           'member_id', r.member_id,
           'name', btrim(concat_ws(' ', m.first_name, m.last_name)),
           'state', COALESCE(resp.status, 'PENDING'),
           'via_group_id', r.via_group_id
         ) ORDER BY r.assignment_id, m.last_name, m.first_name, r.member_id), '[]'::jsonb)
  FROM resolved r
  JOIN members m ON m.id = r.member_id AND m.tenant_id = p_tenant_id AND m.deleted_at IS NULL
  LEFT JOIN event_task_assignment_responses resp
    ON resp.tenant_id = p_tenant_id AND resp.assignment_id = r.assignment_id
   AND resp.member_id = r.member_id AND resp.is_current
$$;

REVOKE EXECUTE ON FUNCTION public.list_event_task_assignee_states(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_event_task_assignee_states(UUID, UUID) TO service_role;
```

**Order for Joseph:** apply this migration in the Supabase SQL Editor **before** merging, because the new code calls the new function. It is purely additive: old code never calls it, so applying it early is safe. Verification query (expects one row: `true | false | false`):

```sql
SELECT has_function_privilege('service_role', 'public.list_event_task_assignee_states(uuid,uuid)', 'EXECUTE') AS service_role_can,
       has_function_privilege('anon', 'public.list_event_task_assignee_states(uuid,uuid)', 'EXECUTE') AS anon_can,
       has_function_privilege('authenticated', 'public.list_event_task_assignee_states(uuid,uuid)', 'EXECUTE') AS authenticated_can;
```

### Branch Name
feature/FP-242-web-assignee-pills

### Commit Message
FP-242-web: show task assignees as colored state pills for the event owner and Admins

### Pull Request Description
Plain GitHub markdown. Include:
- **Summary**, and the migration-order note: apply `20261006000081` before merging, plus the verification query.
- **Acceptance criteria → behavior** (one line each, with evidence from the test script):
  - Owner and Admin see pills: green ✓ committed, red ✕ refused, grey name-only pending, and no state words on screen.
  - A group task shows one pill per member under the group caption, and more than 100 shows "+N more" (web part).
  - Changing a response or replacing a person updates the pills after reload, and a replaced person's pill disappears.
  - A non-owner Leader and a Member see exactly today's rows, and the server returns `[]` and `0` to them.
  - Screen-reader text, plus a contrast table with the six measured ratios (light and dark × three states).
  - Needs Attention, the badge, reports and the Tasks tab are unchanged (show zero-output diffs).
  - Constant query count, with the measured numbers.
- **API contract** for the mobile DIP: the exact shape of `assignee_states` and `assignee_states_total`, the ordering rule, the cap, and that `refused_by` is kept with the same shape and now comes from the same data.
- **Deviations from this DIP** with reasons, including any grounding claim that turned out wrong.
- **Removed code** (`listOutstandingRefusalsForEvent`, `listCurrentRefusedResponsesForEvent`, `OutstandingRefusal`) and the grep that proved nothing else used it.
- **Not tested:** the hosted database; a real browser in both themes (unless you ran one); screen readers (only the markup was checked); concurrency; very large real tenants.
- **Manual steps for Joseph** (preview after deploy):
  1. As Admin, open an event with a direct-member task where one person committed, one refused and one has not answered. You should see three pills: green ✓, red ✕ and grey, and no "Refused:" line.
  2. Open an event with a task assigned to Everyone or another group. You should see the group caption over one pill per member.
  3. Sign in as a Leader who is not the owner. The Tasks section should look exactly as before.
  4. Switch to dark mode and check that the pills are readable.
  5. Have a member change Refuse to Commit on the phone, then reload the page. The pill should turn green.

### Jira Linkage
- PDEEpicID: FP-31
- PDEStoryID: FP-242

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-242-web.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Branch off current dev and open the PR with gh pr create --base dev; quote the base in your report and do NOT stack it on any other branch. Do not apply any migration to a remote database and do not merge: Joseph applies migrations after review, tests, and merges manually.

Include full diffs for every file in your completion report per Section 5, rule 13, not a summary.
