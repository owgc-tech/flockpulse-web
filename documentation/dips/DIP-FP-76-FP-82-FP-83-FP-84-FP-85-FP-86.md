# DIP-FP-76-FP-82-FP-83-FP-84-FP-85-FP-86 — Formation Admin: Course/Module/Talk Management

**Covers:** FP-76 (Demographic Relevance Flags on Talks), FP-82 (Alias/Description on Courses/Modules/Talks), FP-83 (Three-Column Browse Screen), FP-84 (Create/Edit/Delete Overlay), FP-85 (Deletion Guards for Courses/Modules), FP-86 (Drag-and-Drop Reordering)
**Epic:** FP-28 (EPIC-7 — Formation Tracking Engine)

---

## Not Covered — Deliberately Excluded

- **Formation completion/progress reporting** (`formation-completion.service.ts` and related) — already built (Sprint 5), untouched by this DIP.
- **Talk ↔ Event linkage, talk deletion-by-event-reference guard** — already built (migration `20260629000015`, `block_talk_deletion_if_referenced`). This DIP adds an *additional* guard for Courses/Modules (child-based, not event-based) per FP-85; it does not modify the existing Talk guard.
- **Mobile formation display** — mobile repo doesn't exist yet (Section 3). This is web-only, Admin-facing.

---

## Story Summary

Admin currently has no way to manage the Course → Module → Talk hierarchy at all — the tables exist (`20260629000015_formation_structure_and_completion.sql`) with only `name` and `sequence_order`, and the only code touching them is the read-only `formation-completion` progress engine and a backend-only repository/service layer (`src/features/formation/course.*`, `module.*`, `talk.*`) with no UI. This DIP builds the full admin management surface in one combined pass:

- **FP-76:** `alias`/`description`-adjacent but separate — four demographic boolean columns on `talks` (`for_single_men`, `for_single_women`, `for_married_men`, `for_married_women`), `CHECK` requiring at least one `true`. Schema-only in FP-76's original scope; its own AC explicitly defers the UI to "the not-yet-designed Talk edit screen" — that screen is FP-84, built in this same DIP, so FP-76 is pulled in here rather than left dangling.
- **FP-82:** `alias TEXT` and `description TEXT` (both nullable) added to all three tables.
- **FP-83:** The three-column browse screen (Courses | Modules | Talks) that everything else hangs off of.
- **FP-84:** The Create/Edit/Delete overlay — the only way records in any of the three tables get written, including FP-76's demographic checkboxes for Talks.
- **FP-85:** Deletion guards for Courses/Modules (blocked while active children exist) — gates FP-84's trashcan.
- **FP-86:** Drag-and-drop reordering, replacing manual `sequence_order` entry — operates on the same column UI as FP-83, and is why FP-84's AC explicitly makes `sequence_order` read-only in the overlay.

These six are combined per Section 5 Rule 9: FP-83/84/85/86 are structurally inseparable (each story's AC directly references another by name — FP-84 references FP-85's guards and FP-76's checkboxes; FP-85 references FP-83's already-loaded browse data), and splitting them would mean multiple DIPs editing the same files.

---

## Repo Target

**Web — `owgc-tech/flockpulse-web`**, working branch `dev`. Admin-only surface, no mobile component (Section 3).

---

## Grounding Check

1. **Schema names verified against actual migrations, not spec language.** Confirmed via live read of `supabase/migrations/20260629000015_formation_structure_and_completion.sql`: tables are `courses`, `modules`, `talks`, each with `tenant_id`, `name`, `sequence_order INT NOT NULL`, `deleted_at`, cross-tenant-safety `BEFORE INSERT OR UPDATE` triggers (`validate_module_tenant_scope`, `validate_talk_tenant_scope`), and RLS policies (`*_select`, `*_admin_insert`, `*_admin_update` — **no DELETE policy, by design**, per that migration's own comment: soft-delete via UPDATE is the only supported removal path, and a DELETE policy would combine with an existing blanket DELETE grant to allow real hard-delete). This DIP's new triggers/policies must follow the same SELECT/INSERT/UPDATE-only pattern — never add a DELETE policy.

2. **Existing backend layer confirmed and must be extended, not replaced.** `src/features/formation/{course,module,talk}.{repository,service,types}.ts` already exist with a consistent pattern: repository does raw Supabase calls scoped by `tenant_id`, service does validation + friendly error codes (`VALIDATION_ERROR`, `NOT_FOUND`) and maps Postgres `23505` (unique violation on `sequence_order`) and `P0001` (trigger-raised exception) to typed errors. **Extend these files in place — do not create parallel `course-v2` style files.**

3. **FP-76's four demographic columns are net-new — no dependency on FP-84 for their existence, only for their UI.** The schema portion (`ALTER TABLE talks ADD COLUMN ...` + `CHECK`) can and should ship in this DIP's migration regardless of FP-84's build order within this DIP, since Postgres doesn't care about column-vs-UI sequencing. Confirmed via live Jira fetch of FP-76 this session — its AC is unchanged from spec, blocking condition was purely "no screen exists yet," which this DIP resolves.

4. **Real open question — drag-and-drop implementation, not to be silently assumed.** `package.json` currently has zero UI/interaction libraries beyond `next`/`react`/`react-dom`/`@supabase/*` (confirmed via direct read this session) — no `@dnd-kit/*`, `react-beautiful-dnd`, `react-sortablejs`, or similar. FP-86 needs one of: (a) add `@dnd-kit/core` + `@dnd-kit/sortable` (actively maintained, accessible, ~10kb, the current de facto standard — recommended), or (b) hand-roll with native HTML5 Drag and Drop API (`draggable`, `onDragStart`/`onDrop`) to avoid a new dependency, at the cost of more custom code and weaker accessibility/touch support. **Do not silently pick one — confirm with the user (via Atlas) before adding a new dependency to the repo.** Implementation Plan below proceeds assuming `@dnd-kit` is approved; if not, Step 6 needs re-scoping.

5. **Atomic multi-row reorder — a real technical risk, not a standard "one query" operation.** The existing unique indexes (`idx_courses_unique_sequence` on `(tenant_id, sequence_order) WHERE deleted_at IS NULL`, equivalent for modules/talks) are **not deferrable** — they're plain `CREATE UNIQUE INDEX`, not a `DEFERRABLE` constraint. A naive multi-row `UPDATE` that shifts siblings' `sequence_order` (e.g., moving item 5 to position 2, shifting 2→3, 3→4, 4→5) risks a spurious unique-violation if any intermediate row state collides with another row's current value, even within one statement. **Required technique:** the reorder function must do a two-phase update inside one `SECURITY DEFINER` transaction — first move every affected row to a temporary out-of-range negative `sequence_order` (e.g., `-(row_number)`), then in a second `UPDATE` set every row to its real final `sequence_order`. Both phases inside the same function body, same transaction, single call from the client. This is the same "one function, one write path" discipline as Section 5 Rule 5, applied to multi-row-same-table rather than multi-table.

6. **Deletion guard pattern for Courses/Modules must mirror the existing Talk guard's structure, but the condition is different — per FP-85's own AC, don't assume they're interchangeable.** Talk's guard (`block_talk_deletion_if_referenced`) checks `events.talk_id` references, independent of what's loaded in any UI. Course/Module's guard is child-based: a Course can't be soft-deleted while it has any `modules` row with `deleted_at IS NULL`; a Module can't be soft-deleted while it has any `talks` row with `deleted_at IS NULL`. Per FP-85's AC, this also means the browse screen (FP-83) already has the child data loaded and can proactively disable the trashcan client-side — the DB trigger is the backstop, not the primary UX, which is the inverse of how FP-84 treats the demographic-checkbox validation (client-side primary, DB `CHECK` backstop). Both guards ship as `BEFORE UPDATE` triggers (soft-delete is an `UPDATE`, never a `DELETE`, consistent with item 1 above).

7. **No conflicts with Section 4 invariants.** This is formation-structure CRUD only — no RSVP/self-report/attendance data touched. FP-76's demographic flags don't interact with the Attendance Lifecycle Separation rules. Tenant ID is server-derived throughout (existing repository functions already take `tenantId` as an explicit parameter from the caller's JWT-resolved context, per the existing `getAdminContext`-style pattern in `app/admin/invite/actions.ts` — the new Server Actions in this DIP must follow that same pattern, never trust a client-supplied `tenantId`).

8. **Canonical error codes checked (Engineering Spec §6) before use.** `VALIDATION_ERROR` for demographic-checkbox and empty-name failures; `NOT_FOUND` (already used in existing formation service files, though not in the canonical §6 list — flagging this as a pre-existing minor drift, not introducing a new one, and not fixing it as part of this DIP's scope); `INVALID_STATE_TRANSITION` for deletion-guard trigger failures (already the pattern used for the Talk guard in `talk.service.ts`'s `updateTalk` — reuse verbatim for the new Course/Module guards); `CROSS_TENANT_ACCESS` if any tenant-scope trigger fires. No new ad hoc codes invented.

9. **Prior work check:** no `documentation/dips/DIP-FP-82*.md` (or FP-76/83/84/85/86) exists. No `alias`/`description` columns, no demographic columns, no admin UI route for formation exist in the repo (confirmed via direct clone-and-grep this session). Clean slate — despite all six showing "In Progress" in Jira, that status was set immediately before this DIP was requested and doesn't reflect any actual prior implementation.

10. **No existing shared admin layout/nav component.** Every admin page (`/admin/invite`, `/admin/invitations`, `/admin/mfa-enroll`) is a standalone route with its own inline `<a href="...">` links to related pages — no `app/admin/layout.tsx` navigation shell exists yet. This DIP follows that same standalone-route convention for `/admin/formation`; introducing a shared nav shell is out of scope here.

---

## Implementation Plan

### Step 1 — Migration
Single new migration file (verify actual next sequence number against `supabase/migrations/` at execution time — do not assume; latest confirmed this session is `20260706000023_mfa_trust_duration.sql`):

1. `ALTER TABLE courses ADD COLUMN alias TEXT, ADD COLUMN description TEXT;` — same for `modules`, `talks`. Use `ADD COLUMN IF NOT EXISTS` for idempotency.
2. `ALTER TABLE talks ADD COLUMN for_single_men BOOLEAN NOT NULL DEFAULT false, ADD COLUMN for_single_women BOOLEAN NOT NULL DEFAULT false, ADD COLUMN for_married_men BOOLEAN NOT NULL DEFAULT false, ADD COLUMN for_married_women BOOLEAN NOT NULL DEFAULT false;` (all `IF NOT EXISTS`) + a `DO $$ ... pg_constraint ...` idempotency-guarded `CHECK` constraint requiring at least one of the four to be `true`.
3. Course deletion guard: `validate_course_deletion_guard()` `SECURITY DEFINER` trigger function — mirrors `block_talk_deletion_if_referenced`'s structure (checks `NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL`), but condition is `EXISTS (SELECT 1 FROM modules WHERE course_id = NEW.id AND deleted_at IS NULL)`. `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER ... BEFORE UPDATE ON courses`.
4. Module deletion guard: same pattern, condition is `EXISTS (SELECT 1 FROM talks WHERE module_id = NEW.id AND deleted_at IS NULL)`. `BEFORE UPDATE ON modules`.
5. Reorder functions — three `SECURITY DEFINER` functions (`reorder_courses`, `reorder_modules`, `reorder_talks`), each taking `p_tenant_id UUID` + an ordered array of row IDs, performing the two-phase negative-offset-then-final-value update from Grounding Check item 5, inside one transaction. Each must independently re-verify every ID in the array belongs to the given `tenant_id` (and, for modules/talks, the correct parent) before touching any row — do not trust array order/membership from the client.
6. No RLS changes needed — existing `*_admin_insert`/`*_admin_update` policies already cover all new columns since Postgres RLS is row-level, not column-level.

### Step 2 — Backend: extend existing formation feature files
For `course.types.ts` / `module.types.ts` / `talk.types.ts`: add `alias: string | null`, `description: string | null` to each `*Row` interface and corresponding `Create*Input`/`Update*Input`. `talk.types.ts` additionally gets the four boolean fields.

For `course.repository.ts` / `module.repository.ts` / `talk.repository.ts`: extend `.select(...)` column lists, `.insert({...})`, and `patch` logic to include the new fields, following the exact existing pattern (see `module.repository.ts`'s `patchModule` for the `if (input.x !== undefined) patch.x = input.x` style — replicate for `alias`/`description`/demographic booleans).

For `course.service.ts` / `module.service.ts`: no new validation needed for `alias`/`description` (both optional, no format constraint per FP-82's AC). Add a new exported function `reorderCourses(tenantId, orderedIds)` / `reorderModules(courseId, tenantId, orderedIds)` that calls the new repository function wrapping the SQL RPC, validates the array is non-empty, and maps any Postgres error to `VALIDATION_ERROR` or `CROSS_TENANT_ACCESS` as appropriate. Also add a deletion-guard error mapping in `updateCourse`/`updateModule`, identical in structure to `talk.service.ts`'s existing `P0001` → `INVALID_STATE_TRANSITION` handling.

For `talk.service.ts`: `createTalk`/`updateTalk` gain server-side validation that at least one demographic boolean is `true` when any are provided (defense-in-depth backstop; the primary defense is the client form per FP-84 AC item 2) — throw `VALIDATION_ERROR` with a clear message, mirroring the existing `name`/`sequenceOrder` validation style in the same functions. Add `reorderTalks(moduleId, tenantId, orderedIds)` analogous to the above.

### Step 3 — Server Actions layer
New file `app/admin/formation/actions.ts` (or split per entity if it gets unwieldy — CC's call, but keep one `getAdminContext`-equivalent helper following the exact pattern in `app/admin/invite/actions.ts`, not a re-derived variant). Actions needed: `createCourseAction`, `updateCourseAction`, `deleteCourseAction` (soft-delete via update), `reorderCoursesAction`, and the equivalent trio+reorder for modules and talks — 12 actions total, or fewer if some are generically parameterized by entity type (CC's call on DRY-ness vs. explicitness, but every action must independently resolve `tenantId`/`role` from the JWT, never trust a client-supplied value).

### Step 4 — Route & Server Component
`app/admin/formation/page.tsx` — Server Component, same auth-resolution pattern as `app/admin/invitations/page.tsx` (`createSupabaseServerClient()`, `getUser()`, redirect to `/login` if absent/wrong role). Fetches all active Courses (top-level only — Modules/Talks are lazy-fetched client-side on selection, per FP-83's AC that selecting a Course populates the Modules column, not that everything loads upfront). Passes to a Client Component.

### Step 5 — Three-column browse screen (FP-83)
`app/admin/formation/FormationBrowser.tsx` — Client Component. Three equal-width independently-scrollable columns. Selection state: `selectedCourseId`, `selectedModuleId` (reset to `null` whenever `selectedCourseId` changes), `selectedTalkId` (reset whenever `selectedModuleId` changes) — per FP-83 AC's explicit "no partial state carries over" requirement. Each row: hover reveals `alias`/`description` tooltip and an ellipsis (no separate edit icon) that opens the overlay (Step 6). Each column header has a `+`, disabled for Modules/Talks columns until the parent selection exists.

### Step 6 — Create/Edit/Delete overlay (FP-84)
`app/admin/formation/FormationOverlay.tsx` — Client Component, modal/dialog pattern. Fields: `name` (required), `alias`, `description` (both optional) for all three levels; the four demographic checkboxes additionally for Talks, with the client-side "at least one checked" validation blocking Save (per Grounding Check item 6 — primary defense here, unlike the deletion guard). `sequence_order` displayed read-only if shown at all — never an input, per FP-84's explicit AC. While open, the browse screen behind it is fully inert (a simple overlay/backdrop + disabled state on the parent, no chain-reset side effects triggered by background state). Trashcan bottom-left: disabled per FP-85's guard (client-side proactive check using already-loaded child data per Grounding Check item 6); if enabled and clicked, overlay switches to a read-only delete-confirmation state before calling the delete action.

### Step 7 — Drag-and-drop reordering (FP-86)
Contingent on Grounding Check item 4's resolution. If `@dnd-kit` is approved: wrap each column's list in `@dnd-kit/sortable`'s sortable context, `onDragEnd` computes the new order array and calls the corresponding `reorder*Action`. The existing partial-unique-index constraint remains the backstop per FP-86's own AC — the UI's optimistic reorder should roll back on any server-side rejection rather than assume success.

### Step 8 — Regression check
Confirm the existing `formation-completion.service.ts` progress-calculation logic is unaffected — it reads `alias`/`description`/demographic columns not at all (only `id`, `course_id`/`module_id`, `name`, `sequence_order` per its existing `fetchActive*` repository functions), so no changes needed there, but verify by running its existing logic against a course/module/talk created through this DIP's new UI to confirm no regression.

---

## Files to Create/Modify

**Migration:**
- `supabase/migrations/[next-number]_formation_alias_demographics_guards_reorder.sql` (new)

**Backend (modify):**
- `src/features/formation/course.types.ts`
- `src/features/formation/course.repository.ts`
- `src/features/formation/course.service.ts`
- `src/features/formation/module.types.ts`
- `src/features/formation/module.repository.ts`
- `src/features/formation/module.service.ts`
- `src/features/formation/talk.types.ts`
- `src/features/formation/talk.repository.ts`
- `src/features/formation/talk.service.ts`

**Frontend (new):**
- `app/admin/formation/page.tsx`
- `app/admin/formation/actions.ts`
- `app/admin/formation/FormationBrowser.tsx`
- `app/admin/formation/FormationOverlay.tsx`

**Dependency (new, contingent on Grounding Check item 4):**
- `package.json` — `@dnd-kit/core`, `@dnd-kit/sortable` (if approved)

**Test plan:**
- `documentation/test-plans/FP-76-82-83-84-85-86-formation-admin-checklist.md`

---

## Branch Name

`feature/FP-76-FP-82-FP-83-FP-84-FP-85-FP-86-formation-admin`

---

## Commit Message

`FP-76,82,83,84,85,86: Formation admin — Course/Module/Talk management (alias/description, demographic flags, browse/edit UI, deletion guards, drag-and-drop reorder)`

---

## Pull Request Description

Maps to each story's AC:
- **FP-76:** demographic checkboxes now have a home (FP-84's overlay); `CHECK` constraint enforced at DB level, client-side validation blocks Save before it's ever reached.
- **FP-82:** `alias`/`description` present and optional on all three tables, surfaced as tooltip (browse) and input (overlay).
- **FP-83:** three-column browse screen, selection-reset behavior, hover tooltip/ellipsis, disabled `+` until parent selected.
- **FP-84:** overlay create/edit/delete, background fully inert while open, `sequence_order` read-only, demographic validation, delete-confirmation state.
- **FP-85:** Course/Module deletion guards (child-based, DB trigger + proactive client-side disable), explicitly distinguished from Talk's event-reference guard.
- **FP-86:** drag-and-drop reorder, atomic two-phase update avoiding unique-index collision, existing constraint as backstop, optimistic-UI rollback on rejection.

States explicitly how Grounding Check item 4 (drag-and-drop library choice) was resolved, since it was unconfirmed at drafting time.

---

## Jira Linkage

- PDEEpicID: FP-28 (EPIC-7 — Formation Tracking Engine)
- PDEStoryID: FP-76, FP-82, FP-83, FP-84, FP-85, FP-86

---

## Stop Point

Save this DIP verbatim to `documentation/dips/DIP-FP-76-FP-82-FP-83-FP-84-FP-85-FP-86.md` and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description.

**Before writing any code:** resolve Grounding Check item 4 (drag-and-drop library) with the user via Atlas — do not silently add `@dnd-kit` or hand-roll HTML5 DnD without confirmation.

**If any Jira ticket needs to be filed for a finding during this DIP, do not file it directly — report it back for Atlas to file.**

All changes go through a feature branch and a PR — no direct pushes to `dev`, no exceptions.

Create the feature branch, implement, test (minimum 11–15 automated tests per Section 2 of the system prompt, covering: tenant isolation on all new tables/columns, the two-phase reorder function under concurrent-collision conditions, both deletion guards firing correctly and NOT firing when children are already soft-deleted, the demographic `CHECK` constraint rejecting all-false, and the browse screen's selection-reset behavior), commit, push, and open the PR against `dev`. Do not merge — the user will test locally and merge manually.

Include full diffs for every file in your completion report — not a summary.
