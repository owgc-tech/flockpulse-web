# Test Plan: FP-77, FP-78, FP-79, FP-80, FP-81 — Formation Completion Tracking Overhaul

**Branch:** `feature/FP-79-FP-80-FP-81-FP-77-FP-78-formation-completion`
**Migration:** `20260707000026_talk_completions_and_atomic_writes.sql`

---

## 1. Migration Verification

- [ ] `supabase migration up` completes without error
- [ ] `talk_completions` table exists with correct columns: `id, tenant_id, member_id, talk_id, completed_at, source, source_event_id, recorded_by, created_at`
- [ ] `UNIQUE (tenant_id, member_id, talk_id)` constraint exists
- [ ] `source CHECK ('event_attendance', 'manual')` constraint exists
- [ ] RLS enabled on `talk_completions`
- [ ] `sync_talk_completion_for_attendance` function exists in public schema
- [ ] `resolve_leader_confirmation` re-deployed (verify with `\df resolve_leader_confirmation`)
- [ ] `admin_override_attendance` re-deployed

---

## 2. Automated Test Script

Run: `npx tsx scripts/test-fp79-fp80-fp81-fp77-fp78-formation-completion.ts`

All 17 assertions must pass (15 named tests, some with multiple asserts).

---

## 3. Manual UI Checklist

### Admin login and navigation
- [ ] Log in as Admin
- [ ] "Formation Progress" appears in the sidebar
- [ ] Clicking it navigates to `/admin/formation-progress`

### Member picker
- [ ] Member list renders with names and emails
- [ ] Typing in the search box filters the list in real time
- [ ] Selecting a member loads their progress tree
- [ ] Loading state shows while fetching
- [ ] Selecting a different member refreshes the tree

### Progress tree
- [ ] Each course shows as a collapsible row with module count badge
- [ ] Each module shows as a collapsible row with talk count badge
- [ ] Completed talks show a green checkmark
- [ ] Incomplete talks show an empty circle
- [ ] Modules with all relevant talks complete show "Complete"
- [ ] Courses with all modules complete show "Complete"

### Manual completion entry (FP-81)
- [ ] "Record completion" button appears on incomplete talk rows only
- [ ] Clicking opens an inline form with a date picker defaulted to today
- [ ] Submitting inserts a completion row and refreshes the tree
- [ ] The talk now shows as complete (green checkmark)
- [ ] Attempting to record a second time for the same talk shows a conflict error message
- [ ] Cancelling the form hides it without changes

### Demographic relevance (FP-77)
Prerequisites: create a member with `gender=MALE, marital_status=SINGLE` and a talk with `for_single_men=false, for_single_women=true, for_married_men=false, for_married_women=false`.
- [ ] That talk does NOT appear in the progress tree for the MALE+SINGLE member
- [ ] The module containing only that talk shows as "Complete" (vacuously)

---

## 4. Atomic Write Paths (FP-80)

Requires a Talk-linked event and a member self-report.

### resolve_leader_confirmation
- [ ] Confirm a self-report: `talk_completions` row appears with `source=event_attendance`
- [ ] Reject a self-report: no `talk_completions` row created (DID_NOT_ATTEND)
- [ ] Existing audit log writes still present (self_report + attendance entries)
- [ ] `self_report_id` preserved on the attendance row

### admin_override_attendance
- [ ] Override to ATTENDED: `talk_completions` row appears
- [ ] Override to DID_NOT_ATTEND: `talk_completions` row removed (if this event produced it)
- [ ] Overriding a second time: `version` increments correctly
- [ ] Two audit log entries present after two overrides

### Source-precedence
- [ ] Manual completion already exists; ATTENDED override via event → source changes to `event_attendance`
- [ ] Event-attendance completion exists; DID_NOT_ATTEND from a *different* event → row NOT deleted

---

## 5. Regression Checklist

- [ ] `/api/formation/progress?member_id=...` still returns correct JSON shape
- [ ] Formation browser (`/admin/formation`) unaffected
- [ ] Course/Module/Talk CRUD (create, reorder, soft-delete, restore) unaffected
- [ ] `npm run build` passes with no TypeScript errors

---

## 6. Known Exclusions (not tested here)

- Bulk/CSV import (deferred, FP-81 is single-record only)
- Backfill of historical ATTENDED rows (no real data exists pre-launch)
- `marital_status` UI/DB mismatch fix (separate ticket — see DIP Not Covered section)
- EPIC-9 multi-member reports (must call into `computeAllCoursesProgress`, not reinvent)
