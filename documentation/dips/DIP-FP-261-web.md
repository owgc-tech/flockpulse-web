### DIP — FP-261 (Web): "Always show on events" task setting replaces CORE_TASK_NAMES

### Not covered — deliberately excluded
- **The mobile app.** It has its own DIP, `DIP-FP-261-mobile`, which is sent after this one is merged and deployed.
- **Renaming or deleting OWGC's tasks.** Their names stay; only the flag is set.
- **Auto-assign** (`TaskAutoAssignPanel`) and **My Tasks.** They do not use `CORE_TASK_NAMES` (verify).
- **The `individual_only` flag:** unchanged, including the 2026-07 migration that set it for "Prayer Leader".

### Story Summary
The web event form hardcodes `CORE_TASK_NAMES = ['Prayer Leader', 'Food Assignment', 'Music']`. Tasks with those exact names always appear as slots on every event form and have no "Remove" button; other tasks have to be added per event. These names were seeded only for OWGC, so the feature works only for OWGC and keeps religious wording in the code.

This DIP replaces the list with a per-task setting, **"Always show on events"** (`tasks.always_show`):
- Admins set it on the Tasks page.
- The migration turns it on for OWGC's three tasks, so OWGC sees no change.

Decided 2026-11-19 (Joseph).

### Repo Target
Web (`owgc-tech/flockpulse-web`): migration, API, Tasks page and event form. The mobile change comes after this one is deployed, because the phone needs the new field.

**Send this DIP only after `DIP-FP-213-web` is merged.** Both edit `EventForm.tsx`. Branch from `dev` at that point.

### Grounding Check
**Verified by Atlas this session** (`origin/dev` at `f363cc1`):
- **The `tasks` table** (`20260719000051_task_foundation.sql`): `id, tenant_id, name, deleted_at, created_at, updated_at`, RLS on, and a unique index on `(tenant_id, name)` among active rows.
  - `individual_only BOOLEAN NOT NULL DEFAULT false` was added by `20260720000053_task_individual_only.sql`. This DIP mirrors that column and every place it is wired.
- **Repository and service:** `src/features/tasks/task.repository.ts` has `COLS = 'id, tenant_id, name, individual_only, deleted_at, created_at, updated_at'`. `insertTask` and `patchTask` map `individualOnly` → `individual_only`; `task.service.ts` passes it through. `task.types.ts` has `TaskRow.individual_only` and `individualOnly?` on the create and update inputs.
- **API:**
  - `app/api/tasks/route.ts`: GET (any member) and POST (`requireRole('ADMIN')`), which reads `individual_only` from the body;
  - `app/api/tasks/[id]/route.ts`: PATCH (Admin), which reads `individual_only` and `deleted_at`.

  Tenant always comes from `ctx.tenantId`.
- **`app/admin/(shell)/tasks/TasksTable.tsx`:** sends `individual_only` on create (line 38) and edit (line 76), has edit state (line 59), and shows a badge (line 196).
- **`app/admin/(shell)/events/EventForm.tsx`:**
  - line 19 defines `CORE_TASK_NAMES`;
  - line 235: `coreIds = tasks.filter(t => CORE_TASK_NAMES.includes(t.name))`, which seeds the visible slots;
  - line 790: `isCore = CORE_TASK_NAMES.includes(t.name)`, which hides "Remove".
- **Migrations:** the latest is `20261006000083`. FP-262 may take `20261119000084`, so confirm the next free number.

**Re-verify all of the above** after FP-213 has merged; line numbers will shift. Also confirm that `CORE_TASK_NAMES` and the names "Prayer Leader", "Food Assignment" and "Music" appear nowhere else in `app/` and `src/`.

**Rules check:**
- No new table.
- Writes stay single-table updates through the service role.
- Tenant comes from the token.
- Error codes are unchanged: `VALIDATION_ERROR` if `always_show` is not a boolean.
- The phone tolerates an older server (handled in the mobile DIP).

### Implementation Plan
1. **Bootstrap.** Save this DIP verbatim to `documentation/dips/DIP-FP-261-web.md`. Create `feature/FP-261-task-always-show` off current `dev`, after FP-213 has merged.
2. **The migration** `supabase/migrations/20261119000085_task_always_show.sql` (confirm the number):
   ```sql
   ALTER TABLE tasks ADD COLUMN IF NOT EXISTS always_show BOOLEAN NOT NULL DEFAULT false;
   UPDATE tasks SET always_show = true
    WHERE name IN ('Prayer Leader', 'Food Assignment', 'Music') AND always_show = false;
   ```
   Add a header comment with FP-261, the reason, and the note that it replaces `CORE_TASK_NAMES`. The migration is idempotent.
3. **Types, repository and service.** Add `always_show` to `COLS` and `TaskRow`, and `alwaysShow?` to the create and update inputs. Map it in `insertTask` (default `false`) and `patchTask`, and pass it through the service exactly like `individualOnly`.
4. **API.** POST and PATCH accept `always_show`. If it is present and not a boolean, return `VALIDATION_ERROR` (422). GET returns it automatically through `COLS`.
5. **Tasks page.**
   - Add an "Always show on events" checkbox to create and edit, next to the individual-only control, with the same styling and a short helper text: "Shown on every new event form; can't be removed from an event."
   - Show an "Always shown" badge, like the individual-only badge.
6. **`EventForm.tsx`.**
   - Delete `CORE_TASK_NAMES` and its comment.
   - Replace both uses with `t.always_show === true`.
   - Rename `coreIds`/`isCore` to `alwaysShowIds`/`isAlwaysShown`.

   No other behavior changes.
7. **Scratch-database test** (`supabase db reset` locally):
   - plant two tenants. One has active tasks named "Prayer Leader", "Food Assignment" and "Music", plus a soft-deleted "Music". The other has a task named "Workshop";
   - apply the migration;
   - check that the first tenant's three active tasks are true (report what happens to the soft-deleted row; true is acceptable), and that "Workshop" is false;
   - apply it again: no error, no change.

   Paste the results.
8. **Test script** `scripts/test-fp261-always-show.ts` (force-added): a pure check that the API validation rejects a non-boolean `always_show`, and that `CORE_TASK_NAMES` no longer exists in `app/` or `src/`, by grep. Also run any existing task test scripts.
9. **Checks.**
   - Run `npx tsc --noEmit`, lint, `npm run build` and the scripts.
   - Run locally with `npm run dev` and an Admin login:
     - Tasks page: create a task with the box ticked, and see the badge;
     - New Event form: the ticked task appears automatically with no "Remove", and other tasks still need "Add";
     - edit an existing event: assigned tasks still show.

     Report what MFA prevented, if anything.
   - `git diff dev --stat`. Stop the dev server.
10. **Commit, push, and open the PR** with `gh pr create --base dev`.

### Files to Create/Modify
- **Create:**
  - `documentation/dips/DIP-FP-261-web.md` (verbatim, then frozen);
  - `supabase/migrations/20261119000085_task_always_show.sql`;
  - `scripts/test-fp261-always-show.ts`.
- **Modify:**
  - `src/features/tasks/task.types.ts`, `task.repository.ts`, `task.service.ts`;
  - `app/api/tasks/route.ts`, `app/api/tasks/[id]/route.ts`;
  - `app/admin/(shell)/tasks/TasksTable.tsx`;
  - `app/admin/(shell)/events/EventForm.tsx`.
- **Must stay untouched:** `proxy.ts`, `src/lib/site-gate.ts`, `src/lib/auth/`, and other migrations.

### Migration Files (if applicable)
`20261119000085_task_always_show.sql`, as above. Validated locally only; never applied remotely by Claude Code.

**Order: Joseph applies it BEFORE merging.** The API selects `always_show`, so merging first would break the task list on preview.

### Branch Name
feature/FP-261-task-always-show

### Commit Message
FP-261: replace CORE_TASK_NAMES with a per-task "Always show on events" setting

### Pull Request Description
Plain GitHub markdown. Include:
- each acceptance criterion and how it is met;
- the scratch-database results;
- this verification query for Joseph: `SELECT name, always_show FROM tasks WHERE deleted_at IS NULL ORDER BY name;`. Expected: Prayer Leader, Food Assignment and Music are true; everything else is false;
- deviations from this DIP.

**Not tested:** the hosted database, and the mobile app (which comes next).

**Steps for Joseph:**
1. Apply the migration in the SQL Editor on `fpdb-dev`, then run the verification query.
2. Merge into `dev`, and wait for Vercel to show Ready.
3. On preview, as Admin:
   - Tasks page: the three OWGC tasks show "Always shown";
   - New Event: they appear automatically with no "Remove", exactly as before;
   - tick the box on another task: it appears too; untick it: it's gone.
4. Tell Atlas, who then sends `DIP-FP-261-mobile`.

### Jira Linkage
- PDEEpicID: FP-170
- PDEStoryID: FP-261

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-261-web.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Branch off current dev and open the PR with gh pr create --base dev; quote the base in your report and do NOT stack it on any other branch. Do not apply any migration to a remote database and do not merge: Joseph applies migrations after review, tests, and merges manually.

Include full diffs for every file in your completion report per Section 5, rule 13, not a summary.
