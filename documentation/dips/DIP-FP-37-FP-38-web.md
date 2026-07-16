# DIP-FP-37-FP-38

## Story Summary

Adds a new Reports section to the web admin shell covering RSVP reports (STORY-9.1) and Attendance reports (STORY-9.2) — both filterable by event/group/member (Attendance also by date range), both RBAC-scoped so Leader-tier only sees their assigned members. Combined into one DIP because they share the same page shell, the same "expected attendee" base query, and the same RBAC-scoping helper — not because they're coincidentally adjacent. STORY-9.3 (Formation Progress) is deliberately excluded from this DIP — see the note at the end.

## Repo Target

Web (Next.js) — owgc-tech/flockpulse-web. No mobile involvement; reporting has always been admin-only.

## Grounding Check

- Confirmed live: no `src/reports/` or `/admin/reports` currently exists — genuinely new surface, not a UI-only addition.
- Confirmed `event_attendees(tenant_id, event_id, member_id)` is the correct "who's expected at this event" base table — both reports' "No-Response"/"Unresponded" states are computed as expected-members-minus-those-with-a-response, not just listing whatever rows happen to exist.
- Confirmed `rsvps(tenant_id, event_id, member_id, rsvp_status, rsvp_reason, ...)` — matches STORY-9.1's shape exactly (Yes/No/reason).
- Confirmed `member_attendance_reports` (self-report) and `attendance` (official) are genuinely separate tables, as the invariant rules require — `attendance.attendance_status IN ('ATTENDED','DID_NOT_ATTEND')`, `attendance.confirmation_type IN ('leader_confirm','leader_reject','no_self_report_auto','admin_override')`. STORY-9.2's four-state model (ATTENDED/DID_NOT_ATTEND/PENDING_CONFIRMATION/UNRESPONDED) is derived, not stored directly:
  - ATTENDED/DID_NOT_ATTEND — a row exists in `attendance` with that status.
  - PENDING_CONFIRMATION — a `member_attendance_reports` row exists with `self_report_status = 'SELF_REPORTED_YES'` but no corresponding `attendance` row yet.
  - UNRESPONDED — neither a self-report nor an attendance row exists for this expected member.
- Confirmed the exact RBAC-scoping pattern to reuse: `assignments(tenant_id, member_id, assignment_type, target_id)` where `assignment_type = 'LEADER'` and `target_id` = the leader's own `member_id` — this is the identical shape already used by `confirmation.repository.ts`'s `getAssignedMemberIds()`. Reuse that function directly (it's already tenant-scoped and correct) rather than reimplementing the same query a third time.
- Confirmed the group-filter join: assignments where `assignment_type = 'GROUP'` and `target_id` = the selected group's id.
- Confirmed no reporting-specific indexes exist yet on `rsvps`/`attendance`/`member_attendance_reports`/`event_attendees` beyond their primary keys and existing FKs — both reports will scan across event/member/group joins at read time, so this needs real indexes, not just correctness.
- No Section 4 invariant rules touched — this is read-only reporting over already-correct data; it doesn't write to RSVP, self-report, or attendance at all.

## Implementation Plan

1. Migration: add reporting-supporting indexes — `rsvps(event_id)`, `rsvps(member_id)`, `attendance(event_id)`, `attendance(member_id)`, `attendance(attendance_status)`, `member_attendance_reports(event_id)`, `member_attendance_reports(member_id)`, `member_attendance_reports(self_report_status)`, `events(start_datetime)` (for Attendance's date-range filter), `assignments(assignment_type, target_id)` (for both the leader-scope and group-filter joins). Standard `CREATE INDEX IF NOT EXISTS` idempotency.
2. New `src/features/reports/report.repository.ts`:
   - `getRsvpReport(tenantId, { eventId?, groupId?, memberId?, leaderScopedMemberIds? })` — base query on `event_attendees` for the selected event(s), left-joined to `rsvps`, deriving `YES | NO | NO_RESPONSE`, including `rsvp_reason` for `NO`.
   - `getAttendanceReport(tenantId, { eventId?, groupId?, memberId?, dateFrom?, dateTo?, leaderScopedMemberIds? })` — base query on `event_attendees` (scoped to events within the date range), left-joined to both `member_attendance_reports` and `attendance`, deriving the four-state status per the Grounding Check's exact rules above.
3. New `src/features/reports/report.service.ts` — thin layer resolving the caller's RBAC scope (Leader-tier → `getAssignedMemberIds()`, Admin-tier → no filter) before calling the repository functions, mirroring the existing pattern in `formation-progress/actions.ts`.
4. New `app/api/reports/rsvp/route.ts` and `app/api/reports/attendance/route.ts` — GET, withAuth, Leader-tier-or-above (mirrors Confirmations' access level, not Admin-only — reports are a Leader-tier capability per the epic description, same as Formation Progress already is).
5. New `app/admin/(shell)/reports/page.tsx` — new "Reports" nav entry in `AdminSidebar.tsx` (`adminOnly: false`, same as Formation Progress and Events), with tabs or sub-routes for RSVP and Attendance.
6. `RsvpReportBrowser.tsx` / `AttendanceReportBrowser.tsx` — filter controls (event/group/member/date-range as applicable) + results table. Model the overall page/filter-and-table shape on `FormationProgressBrowser.tsx`'s existing structure rather than inventing a new admin-page convention.

## Files to Create/Modify

```
supabase/migrations/[timestamp]_reporting_indexes.sql   (new)
src/features/reports/report.repository.ts                (new)
src/features/reports/report.service.ts                   (new)
app/api/reports/rsvp/route.ts                             (new)
app/api/reports/attendance/route.ts                       (new)
app/admin/(shell)/reports/page.tsx                        (new)
app/admin/(shell)/reports/RsvpReportBrowser.tsx            (new)
app/admin/(shell)/reports/AttendanceReportBrowser.tsx       (new)
src/components/admin/AdminSidebar.tsx                      (modified — new nav entry)
```

## Migration Files

As detailed in Implementation Plan step 1 — indexes only, no schema changes, no new tables.

## Branch Name

`feature/FP-37-FP-38-web-rsvp-attendance-reports`

## Commit Message

`FP-37-FP-38-web: add RSVP and Attendance reports to admin Reports section`

## Pull Request Description

Maps to STORY-9.1 and STORY-9.2's ACs: RSVP report (Yes/No/No-Response distribution, filterable by event/group/member, reason shown for No); Attendance report (self-report status vs. official attendance status shown side-by-side, four-state derivation, filterable by event/group/member/date range, missing-official-attendance identified); both RBAC-scoped so Leader-tier sees only their assigned members, reusing the existing `getAssignedMemberIds()` helper rather than reimplementing it.

## Jira Linkage

- PDEEpicID: FP-31 (confirm this — I used the wrong placeholder; actual EPIC-9 key needs to be looked up in Jira, not assumed)
- PDEStoryID: FP-37, FP-38

## Stop Point

Save this DIP verbatim to `documentation/dips/DIP-FP-37-FP-38-web.md`. Open the PR against `dev` and stop — do not merge.
