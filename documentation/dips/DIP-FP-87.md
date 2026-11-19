# DIP-FP-87 — Deleted Items Screen (View and Restore)

**Covers:** FP-87 (Deleted Items Screen — View and Restore)
**Epic:** FP-28 (EPIC-7 — Formation Tracking Engine)

---

## Story Summary

A separate Admin screen listing every soft-deleted Course, Module, and Talk, tenant-scoped, with a Restore action per item. Keeps the main three-column Formation screen (FP-83) clean — deleted items never appear there, and this is the only place they're visible or recoverable. Restoring a child whose parent is also deleted is **blocked**, not cascaded — confirmed directly with the user (Option A from FP-87's own flagged open question), with an error naming the specific parent that must be restored first.

---

## Repo Target

**Web — `owgc-tech/flockpulse-web`**, working branch `dev`. Admin-only, same surface area as FP-76–86.

---

## Grounding Check

1. **Existing `includeDeleted` parameter confirmed, but insufficient alone for this screen.** `listCourses(tenantId, includeDeleted)` is already tenant-wide and works as-is for the Courses tab. `listModulesByCourse(courseId, tenantId, includeDeleted)` and `listTalksByModule(moduleId, tenantId, includeDeleted)` are **parent-scoped** — there is no existing tenant-wide "all deleted Modules across every Course" or "all deleted Talks across every Module" query. New repository functions are required for Modules and Talks; Courses can reuse the existing function directly.

2. **Real technical risk — restoring can collide with the partial unique index on `sequence_order`, and this is not hypothetical.** `idx_courses_unique_sequence` / `idx_modules_unique_sequence` / `idx_talks_unique_sequence` are all `WHERE deleted_at IS NULL` partial indexes. A deleted record retains its original `sequence_order` value. If a new sibling was created (or an existing one reordered) into that same position after the deletion, restoring the old record will throw a `23505` unique violation — the position is no longer free. **Restore must not blindly clear `deleted_at`.** The service-layer restore function must, in one operation: fetch the current max `sequence_order` among active siblings at the same level (same `tenant_id` for Courses; same `course_id` for Modules; same `module_id` for Talks), and set the restored record's `sequence_order` to `max + 1` rather than preserving its original position. This means a restored item always reappears at the end of its column, not wherever it used to sit — confirmed as acceptable since FP-87's AC doesn't require position preservation, and preserving it isn't safely possible in general.

3. **Parent-restore blocking check is on the immediate parent only, not a recursive ancestor walk — this is sufficient by construction.** Restoring a Talk whose Module is deleted must block on the Module. Restoring a Module whose Course is deleted must block on the Course. Because both checks are the same shape, a Talk whose Module *and* Course are both deleted is naturally handled without a special case: the user is blocked on the Module first; once they restore the Module, that restore in turn is naturally the next thing they'd need to check against the Course (a Module can't be un-deleted while its Course is deleted, if the Module's own restore path enforces the identical rule at its level). This DIP implements the identical one-level check at both the Module→Course and Talk→Module boundaries — no cross-level lookahead needed.

4. **No conflicts with existing deletion-guard triggers.** `validate_course_deletion_guard()` / `validate_module_deletion_guard()` / `block_talk_deletion_if_referenced()` all key off `NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL` (the soft-delete transition specifically). A restore is the opposite transition (`OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL`) and does not trigger any of these guards. No migration changes needed to the existing guard functions.

5. **Cross-tenant safety triggers (`validate_module_tenant_scope`, `validate_talk_tenant_scope`) fire on every `UPDATE`, including restore — this is correct and requires no change.** They only check that the parent still belongs to the same tenant, which remains true across a restore. No interaction with this DIP's new logic.

6. **Canonical error codes.** `INVALID_STATE_TRANSITION` for a blocked restore due to a deleted parent — same code already used for the FP-85 deletion-guard rejections, since this is conceptually the same category (an action rejected because of the record's current state relative to its hierarchy). `NOT_FOUND` if the target ID doesn't exist or doesn't belong to the tenant. No new ad hoc codes.

7. **No shared admin nav shell exists yet (confirmed again this session) — deliberately deferred, not part of this DIP.** Per the user's explicit sequencing: build the nav shell *after* FP-87. This DIP's new routes get the same lightweight inline cross-links every other admin page currently has (see `app/admin/invitations/page.tsx`'s pattern), not a sidebar. When the nav shell is built, it will link to these routes; no rework of this DIP's routes should be needed at that point beyond removing the now-redundant inline links.

8. **Route structure decision — three separate routes, not one tabbed page, to match the eventual nav shell's described structure ("Record Restorations" with Course/Modules/Talks as sub-items).** `/admin/restore/courses`, `/admin/restore/modules`, `/admin/restore/talks`. An index redirect at `/admin/restore` → `/admin/restore/courses` as a sensible default landing.

9. **No conflicts with Section 4 invariants.** Formation-structure CRUD only, same as FP-76–86. No RSVP/self-report/attendance interaction.

10. **Prior work check:** no `documentation/dips/DIP-FP-87*.md` exists. No restore UI, no tenant-wide deleted-Module/Talk queries exist in the repo (confirmed via direct clone-and-grep this session).

---

## Implementation Plan

### Step 1 — Backend: new repository functions
- `course.repository.ts`: no new function needed — `listCourses(tenantId, true)` already returns all (active + deleted); filter to deleted-only in the service layer.
- `module.repository.ts`: add `listDeletedModulesForTenant(tenantId)` — tenant-wide query (`.eq('tenant_id', tenantId).not('deleted_at', 'is', null)`), also selecting the parent `course_id` so the service layer can resolve the parent Course's name and deletion status.
- `talk.repository.ts`: add `listDeletedTalksForTenant(tenantId)` — same shape, selecting `module_id`.
- Add `restoreCourseRpc`-equivalent logic directly in the service layer (Step 2) rather than a new SQL function — the max-`sequence_order`-then-restore logic is two simple queries plus one update, doesn't need the atomicity guarantees a `SECURITY DEFINER` function provides for the *reorder* case (Section 5 Rule 5's atomicity concern was about multi-row batch updates; a single-row restore doesn't have that same collision surface, since only one row's `sequence_order` is being set, not many at once).

### Step 2 — Backend: service-layer restore + list functions
`course.service.ts`:
- `listDeletedCourses(tenantId)`: calls `listCourses(tenantId, true)`, filters to `deleted_at !== null`.
- `restoreCourse(id, tenantId)`: fetch the course (must exist, must be deleted — else `NOT_FOUND`/`VALIDATION_ERROR`), fetch max active `sequence_order` for the tenant, `patchCourse(id, tenantId, { deletedAt: null, sequenceOrder: maxActive + 1 })`.

`module.service.ts`:
- `listDeletedModules(tenantId)`: calls new repository function, joins/attaches parent Course name + `course.deleted_at` for display and gating.
- `restoreModule(id, tenantId)`: fetch the module (must exist, must be deleted), fetch its parent Course — if `course.deleted_at !== null`, throw `INVALID_STATE_TRANSITION` with message `Restore course "${course.name}" first`. Otherwise fetch max active `sequence_order` among siblings (`course_id` match), restore with `sequenceOrder: maxActive + 1`.

`talk.service.ts`:
- `listDeletedTalks(tenantId)`: calls new repository function, joins/attaches parent Module name + `module.deleted_at`.
- `restoreTalk(id, tenantId)`: same pattern — fetch parent Module, block with `Restore module "${module.name}" first` if the Module is deleted, otherwise restore with `sequenceOrder: maxActive + 1` among Talk siblings.

### Step 3 — Server Actions
New file `app/admin/restore/actions.ts`, same `getAdminContext` pattern as `app/admin/formation/actions.ts` (do not re-derive — import or replicate verbatim). Six actions: `listDeletedCoursesAction`, `restoreCourseAction`, `listDeletedModulesAction`, `restoreModuleAction`, `listDeletedTalksAction`, `restoreTalkAction`.

### Step 4 — Routes
- `app/admin/restore/page.tsx` — redirects to `/admin/restore/courses`.
- `app/admin/restore/courses/page.tsx` — Server Component, same auth-resolution pattern as `app/admin/invitations/page.tsx`, fetches deleted Courses, passes to a Client Component list.
- `app/admin/restore/modules/page.tsx` — same pattern, deleted Modules (with parent Course name + deleted status).
- `app/admin/restore/talks/page.tsx` — same pattern, deleted Talks (with parent Module name + deleted status).
- Each page: simple list (name, alias if present, `deleted_at` timestamp formatted, parent info where applicable), a "Restore" button per row. If blocked (parent still deleted), the button either disables proactively (client already has the parent's deletion status from the list payload — no need to attempt-and-fail) with a tooltip/inline note naming the parent, mirroring the FP-85 proactive-disable pattern rather than the attempt-then-error pattern.
- Lightweight inline cross-links between the three tabs and back to `/admin/formation`, consistent with existing convention (Grounding Check item 7) — no sidebar yet.

### Step 5 — Regression check
Confirm `formation-completion.service.ts` is unaffected (it never reads deleted rows by design — `fetchActive*` functions all filter `deleted_at IS NULL`, untouched by this DIP). Confirm FP-83's browse screen continues to show zero deleted items (no change needed there, but verify by restoring an item through this new screen and confirming it reappears correctly in the FP-83 browse view at the end of its column, per Grounding Check item 2).

---

## Files to Create/Modify

**Backend (modify):**
- `src/features/formation/course.service.ts` (add `listDeletedCourses`, `restoreCourse`)
- `src/features/formation/module.repository.ts` (add `listDeletedModulesForTenant`)
- `src/features/formation/module.service.ts` (add `listDeletedModules`, `restoreModule`)
- `src/features/formation/talk.repository.ts` (add `listDeletedTalksForTenant`)
- `src/features/formation/talk.service.ts` (add `listDeletedTalks`, `restoreTalk`)

**Frontend (new):**
- `app/admin/restore/page.tsx`
- `app/admin/restore/actions.ts`
- `app/admin/restore/courses/page.tsx`
- `app/admin/restore/courses/DeletedCoursesTable.tsx`
- `app/admin/restore/modules/page.tsx`
- `app/admin/restore/modules/DeletedModulesTable.tsx`
- `app/admin/restore/talks/page.tsx`
- `app/admin/restore/talks/DeletedTalksTable.tsx`

**Test plan:**
- `documentation/test-plans/FP-87-deleted-items-restore-checklist.md`

**No migration required** — no schema changes, only new queries against existing columns.

---

## Branch Name

`feature/FP-87-deleted-items-restore`

---

## Commit Message

`FP-87: Deleted Items screen — view and restore Courses/Modules/Talks with parent-guard blocking`

---

## Pull Request Description

Maps to FP-87's AC:
- Lists all soft-deleted records across all three levels, tenant-scoped (three separate routes, one per level).
- Restore action clears `deleted_at` — but reassigns `sequence_order` to avoid the partial-unique-index collision explained in Grounding Check item 2, since position preservation isn't AC-required and isn't safely possible.
- Restoring a Module/Talk whose parent is also deleted is **blocked** (Option A, confirmed by the user), with an error naming the specific parent to restore first — surfaced proactively in the UI (disabled button + note) rather than only as an attempt-and-fail error.

States explicitly that no migration was needed, and that the deletion-guard triggers were confirmed not to fire on the restore transition (Grounding Check item 4).

---

## Jira Linkage

- PDEEpicID: FP-28 (EPIC-7 — Formation Tracking Engine)
- PDEStoryID: FP-87

---

## Stop Point

Save this DIP verbatim to `documentation/dips/DIP-FP-87.md` and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description.

**Standing requirement (per prior session correction):** since this DIP touches `.ts`/`.tsx` application code, `npm run build` must pass cleanly before pushing/opening the PR — not just the custom `tsx` test script.

**If any Jira ticket needs to be filed for a finding during this DIP, do not file it directly — report it back for Atlas to file.**

All changes go through a feature branch and a PR — no direct pushes to `dev`, no exceptions.

Create the feature branch, implement, test (minimum 11–15 automated tests, covering: tenant isolation on all three deleted-list queries, the `sequence_order` reassignment-on-restore avoiding collision with an active sibling occupying the old position, the parent-deleted blocking logic for both Module→Course and Talk→Module, and confirming the deletion-guard triggers do not fire on restore), run `npm run build` clean, commit, push, and open the PR against `dev`. Do not merge — the user will test locally and merge manually.

Include full diffs for every file in your completion report — not a summary.
