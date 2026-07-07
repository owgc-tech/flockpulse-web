# Test Plan — FP-76 / FP-82 / FP-83 / FP-84 / FP-85 / FP-86 Formation Admin

## Automated (run `npx tsx scripts/test-fp76-82-83-84-85-86-formation-admin.ts`)

- [ ] 1.1 courses / modules / talks tables have `alias` + `description` columns
- [ ] 1.2 `talks` table has all four demographic boolean columns
- [ ] 1.3 `talks` demographic CHECK constraint rejects all-false row (DB-level guard)
- [ ] 1.4 `reorder_courses()` RPC exists in public schema
- [ ] 1.5 `reorder_modules()` RPC exists in public schema
- [ ] 1.6 `reorder_talks()` RPC exists in public schema
- [ ] 2.1 `createCourse()` round-trips `alias` and `description`
- [ ] 2.2 `updateCourse()` updates `alias` and `description`
- [ ] 2.3 `reorderCourses()` two-phase: final `sequence_order` values match supplied order
- [ ] 2.4 Course soft-delete blocked (INVALID_STATE_TRANSITION) when active modules exist
- [ ] 2.5 Course soft-delete succeeds after modules soft-deleted
- [ ] 3.1 `createModule()` round-trips `alias` and `description`
- [ ] 3.2 `reorderModules()` reorders correctly
- [ ] 3.3 Module soft-delete blocked (INVALID_STATE_TRANSITION) when active talks exist
- [ ] 3.4 Module soft-delete succeeds after talks soft-deleted
- [ ] 4.1 `createTalk()` round-trips demographics
- [ ] 4.2 `createTalk()` VALIDATION_ERROR when all demographic flags false
- [ ] 4.3 `reorderTalks()` reorders correctly
- [ ] 4.4 Cross-tenant reorder rejected (tenant B cannot move tenant A's courses)

---

## Manual — FP-76 (Course management)

- [ ] Admin can open `/admin/formation`; three-column browser renders
- [ ] `+` button in Courses column opens "New Course" overlay
- [ ] Create course with name only → saved, appears in Courses column
- [ ] Create course with name + alias + description → tooltip on hover shows alias/description
- [ ] Edit course (ellipsis → overlay) → name/alias/description pre-populated, Save works
- [ ] Delete button absent when course has active modules (tooltip: "Delete all modules first")
- [ ] Delete button present and functional after all modules removed

## Manual — FP-82 (Module management)

- [ ] `+` button in Modules column disabled (greyed) until a course is selected
- [ ] After selecting course, `+` creates new module scoped to that course
- [ ] Edit module → fields pre-populated; save works
- [ ] Delete blocked if module has active talks

## Manual — FP-83 (Three-column browse — selection state)

- [ ] Selecting a different course clears module and talk selections (no partial state)
- [ ] Selecting a different module clears talk selection
- [ ] Module column lazy-loads on course selection (loading indicator visible briefly)
- [ ] Talk column lazy-loads on module selection

## Manual — FP-84 (Talk management)

- [ ] `+` button in Talks column disabled until a module is selected
- [ ] Create talk → "Audience" checkboxes shown; at least one required
- [ ] Submitting with no audience checkbox checked shows inline error "Select at least one audience group." and blocks submission
- [ ] Create talk with multiple audience flags → saved, values persist on edit re-open
- [ ] Edit talk → demographic checkboxes correctly pre-checked

## Manual — FP-85 (Alias / description)

- [ ] Alias field optional on all three entity types; empty string saved as null
- [ ] Description field optional; textarea accepts multi-line text
- [ ] Hover over row with alias/description → tooltip appears showing both values
- [ ] Hover over row with neither alias nor description → no tooltip rendered

## Manual — FP-86 (Drag-and-drop reorder)

- [ ] Courses column: drag a row to a new position → order persists on page reload
- [ ] Modules column: drag within current course → order persists
- [ ] Talks column: drag within current module → order persists
- [ ] Optimistic update: row moves immediately on drag-end, does not snap back on success
- [ ] If reorder server action fails (simulate by disconnecting), row snaps back to original position and error banner appears
- [ ] Drag handle (⠿) is the drag target; clicking the row name still selects the item normally

## Manual — Regression

- [ ] `/admin/invitations` page unaffected
- [ ] Invite flow still works end-to-end
- [ ] Non-admin accessing `/admin/formation` is redirected to `/login`
- [ ] Unauthenticated access to `/admin/formation` is redirected to `/login`
