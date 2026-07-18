DIP-FP-140-adj-1.md
Story Summary
Post-merge follow-up to DIP-FP-140.md (PR #86). The Event Date filter works correctly, but neither report's results show the event's date — so once a report is run, there's no way to tell which occurrence of a repeated-name event each row belongs to, which is the exact ambiguity FP-140 was meant to resolve. The Attendance report already selects event_start_datetime in its query and type — the data's there, just never rendered as a column. The RSVP report's backend never selects or returns event date at all on either of its two endpoints (detail rows or per-event summary) — that's a genuine gap, not just a missing column.
Repo Target
Web (Next.js) — owgc-tech/flockpulse-web.
Grounding Check
Confirmed live against dev (post-PR #86):

Attendance report: AttendanceReportRow (in AttendanceReportBrowser.tsx) already has event_start_datetime: string, and report.repository.ts's attendance query already selects and returns it (events(name, start_datetime), confirmed at the SQL/select level). The table just never renders it — a pure frontend addition, no backend change needed for this half.
RSVP report: both getRsvpReport (detail rows) and getRsvpReportSummary (per-event aggregate) in report.repository.ts select only events(name) — no start_datetime in either query, and neither RsvpReportRow nor RsvpReportSummaryRow (declared both in the repository and, separately, redeclared locally in RsvpReportBrowser.tsx to describe the API response shape) has an event_start_datetime field. This needs a real widening at the query, type, and mapping level on both functions.
API routes are pure pass-through (/api/reports/rsvp and /api/reports/rsvp/summary both just do NextResponse.json({ data }) with no reshaping) — confirmed no route changes are needed; widening the repository's row types is sufficient for the new field to reach the client.
report.service.ts re-uses the repository's types directly (no local redeclaration) — confirmed no changes needed there either.
Display format distinct from the filter's internal format: the FP-140 filter's toLocalDateString() helper (src/lib/dateFilter.ts) produces a YYYY-MM-DD string, purpose-built for <input type="date">'s value binding — not intended as display copy. This DIP uses new Date(x).toLocaleDateString() for the new report columns instead, a distinct, human-readable, locale-aware format — not reusing the filter helper for a different job.
Both RsvpReportBrowser.tsx tables (summary and detail) and the single AttendanceReportBrowser.tsx table currently have "Event" as their first column — the new "Date" column goes immediately after it in all three tables, for a consistent reading order across both reports.
Domain rules: no conflict — purely adding an already-computable column to existing report output, no new report parameter, no RBAC change (same tenant/leader-scoped rows as before, just exposing one more field already implicitly available via the existing event join).

Implementation Plan

report.repository.ts — getRsvpReport: widen the event_attendees select from events(name) to events(name, start_datetime); widen the local cast type accordingly; add event_start_datetime: event?.start_datetime ?? '' to the returned object; add event_start_datetime: string to the RsvpReportRow interface.
report.repository.ts — getRsvpReportSummary: same treatment — widen the select, widen the cast, add event_start_datetime to both the RsvpReportSummaryRow interface and the object constructed the first time each event is encountered in the aggregation loop.
RsvpReportBrowser.tsx: widen both locally-declared RsvpReportRow and RsvpReportSummaryRow interfaces to include event_start_datetime: string, matching the now-widened API response. Add a "Date" <th>/<td> immediately after "Event" in both the summary table and the detail table, rendering new Date(row.event_start_datetime).toLocaleDateString().
AttendanceReportBrowser.tsx: no type or repository change needed (data already present) — add a "Date" <th>/<td> immediately after "Event" in the existing table, rendering new Date(row.event_start_datetime).toLocaleDateString().

Files to Create/Modify

src/features/reports/report.repository.ts
app/admin/(shell)/reports/RsvpReportBrowser.tsx
app/admin/(shell)/reports/AttendanceReportBrowser.tsx

Migration Files
Not applicable — events.start_datetime already exists; this only widens existing SELECTs, no schema change.
Branch Name
feature/FP-140-adj-1-report-event-date-column
Commit Message
FP-140: show event date as a column in RSVP and Attendance report results
Pull Request Description
Fixes a gap found immediately after PR #86 (the Event Date filter): the filter narrows the picker correctly, but report results still didn't show which date each row's event occurred on, defeating the point when running a report across "All events." RSVP report needed a real backend widening (event date was never selected); Attendance report only needed the already-available data rendered.
Jira Linkage

PDEEpicID: FP-36 (EPIC-9 — Reporting & Metrics)
PDEStoryID: FP-140

Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-140-adj-1.md, frozen after save — same -adj-1 convention as prior post-merge fixes. npm run build must pass cleanly. Open PR against dev, do not merge. No migration, no remote step.
Include full diffs for every file in the completion report.
