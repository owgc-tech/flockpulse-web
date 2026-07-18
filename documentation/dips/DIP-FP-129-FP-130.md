DIP-FP-129-FP-130.md
Story Summary
FP-129 brings OWGC's legacy per-event-type attendance spreadsheet (member rows × yearly Present/Absent/%Present columns) into FlockPulse. FP-130 is a date-range attendance-percentage report at three granularities (Member/Group/Community). Both stories explicitly identify themselves as bundling candidates in their own Jira descriptions — they compute the same underlying numerator/denominator (official ATTENDED/DID_NOT_ATTEND against event_attendees expected-slots, restricted to events that have actually concluded) and both need the same event-type multi-select filter, which FP-130's own AC explicitly says not to build twice. This DIP adds both as new sections on the existing Attendance Report page, additive to its current detail table — the same pattern already established when FP-128 added an aggregate summary alongside RSVP's existing detail rows, not a replacement.
Repo Target
Web (Next.js) — owgc-tech/flockpulse-web. No mobile surface — confirmed no admin reporting screens exist on mobile, consistent with every prior reporting story.
Grounding Check
Confirmed live against dev:

Numerator/denominator sourcing: attendance.attendance_status IN ('ATTENDED','DID_NOT_ATTEND') is the sole source of official outcomes (migration 20260629000008); event_attendees (event_id, member_id, no status of its own) is the expected-slot denominator source — both exactly as each story's AC states, already used identically in the existing getAttendanceReport.
Effective event status: get_event_effective_status(event_id) (migration 20260629000009) derives SCHEDULED/ACTIVE/COMPLETED/LOCKED/DRAFT/CANCELLED from now() vs. start_datetime/end_datetime/tenants.attendance_window_hours. A bulk version already exists (get_events_effective_statuses(tenant_id, event_ids[]), migration 20260717000043, service_role-only) — built for exactly this "filter a list of events by derived status without N round trips" need. Both new report functions use this bulk RPC rather than the per-event version, avoiding an N-call performance trap a naive implementation would fall into.
A genuine edge case neither story's AC addresses explicitly: an event can be COMPLETED (window still open) with some expected members already confirmed and others not yet — for those still-pending member-event slots, there is no attendance row at all. Counting a pending slot as "expected" without a resolved outcome would silently inflate whichever bucket it's forced into. Design decision: a member-event slot with no attendance row is excluded from both numerator and denominator for that slot (neither present nor absent) until it resolves — naturally self-corrects once the event reaches LOCKED (the existing no_self_report_auto mechanism resolves every remaining slot to DID_NOT_ATTEND at that point, per established precedent). This only matters for COMPLETED-but-not-yet-LOCKED events; LOCKED events have no pending slots by construction.
RBAC precedent: resolveLeaderScope() + getAssignedMemberIds() (already used identically by every existing report function) is reused unchanged for MEMBER and GROUP granularities — a Leader-tier caller's GROUP view is naturally narrowed to their assigned members' contribution to that group via the existing resolveMemberIdFilter intersection logic, no new mechanism needed. COMMUNITY granularity is the one exception: per FP-130's explicit AC, blocked outright for Leader-tier (a leader-scoped "community" number would be misleading) — this needs an explicit check the existing helper doesn't provide, since every other report treats Leader-tier as "scoped," never "denied."
Event type multi-select: no existing multi-select UI pattern anywhere in this codebase (confirmed via grep — every existing filter is a single <select>). Built here as a simple checkbox list, consistent with this codebase's plain-HTML-controls convention (no UI library), shared between both new sections on the page.
FP-38 extension decision (per both stories' explicit "verify at DIP time, prefer extending"): the existing detail table's per-row shape (event/member/status) is structurally incompatible with either new report's aggregate/matrix shape — extending it in place isn't feasible without contorting one or the other. Both land as new, additive sections on the same /admin/reports/attendance page instead, matching the FP-128 precedent exactly (existing detail view untouched).
Percentage display: no existing precedent for percentage formatting in this codebase (existing reports show raw counts/statuses only) — this DIP rounds to one decimal place (e.g. 82.4%) as a reasonable default, and renders — (matching the existing rsvp_reason ?? '—' convention) for zero-expected-slots cases, never 0%, per both stories' explicit "no-data, not 0%" requirement.
Domain rules: no conflict — pure reporting, read-only, no writes to attendance/event_attendees/formation state.

Implementation Plan

report.repository.ts — shared raw fetcher: getEligibleAttendanceRows(tenantId, { eventTypeIds, dateFrom?, dateTo?, memberIdFilter }). Queries event_attendees ⋈ events(start_datetime, event_type_id) filtered by tenant, event_type_id IN (eventTypeIds), optional start_datetime range, optional member filter. Bulk-fetches effective status via get_events_effective_statuses, filters to COMPLETED/LOCKED only. Fetches attendance rows for the surviving (event_id, member_id) pairs. Returns { event_id, member_id, start_datetime, attendance_status: 'ATTENDED' | 'DID_NOT_ATTEND' | null }[] — null meaning "pending, excluded from aggregation" per the Grounding Check's edge-case decision.
report.repository.ts — FP-129: getAttendanceMatrixByEventType(tenantId, { eventTypeIds, memberIdFilter }). Calls the shared fetcher with no date bounds (whole history), groups by member × EXTRACT(year FROM start_datetime) in JS, computing present/absent/percent per cell (null counts excluded from both). Years are whatever's actually present in the data — not a hardcoded 2018–2025 range, since that was specific to the legacy spreadsheet, not a FlockPulse invariant.
report.repository.ts — FP-130: getAttendancePercentage(tenantId, { eventTypeIds?, dateFrom, dateTo, granularity, memberIdFilter, groups }). Calls the shared fetcher with the given date range (event type filter optional here per FP-130's AC — omitting it means all types). For MEMBER: per-member present/absent/percent, one row per member. For GROUP: for each group, sum present/absent across all its members' rows first, compute percent from the sums (weighted, not averaged, per explicit AC) — one row per group. For COMMUNITY: single aggregate row summing across every scoped member.
report.service.ts: two new wrapper functions mirroring the existing resolveLeaderScope pattern for MEMBER/GROUP. For COMMUNITY, add an explicit if (isExactlyLeaderTier(callerRole)) throw err('FORBIDDEN_ROLE', ...) before calling the repository — the one new RBAC branch this DIP needs beyond existing precedent.
New API routes: app/api/reports/attendance/matrix/route.ts (FP-129) and app/api/reports/attendance/percentage/route.ts (FP-130), both mirroring the existing /api/reports/attendance/route.ts's auth/error-handling shape exactly.
app/admin/(shell)/reports/attendance/page.tsx: fetch listEventTypes(tenantId) alongside the existing members/groups/events fetches, pass down to AttendanceReportBrowser.
AttendanceReportBrowser.tsx: add a shared event-type checkbox-list component (used by both new sections), a "Yearly Matrix by Event Type" section (FP-129 — member rows, year columns, Present/Absent/%), and an "Attendance % by Date Range" section (FP-130 — date range inputs + Member/Group/Community radio toggle, results table shaped to whichever granularity is selected). Both sections sit below the existing detail table, collapsible/expandable if that keeps the page from feeling cluttered — implementation's call on exact layout, not dictated here.

Files to Create/Modify

src/features/reports/report.repository.ts
src/features/reports/report.service.ts
app/api/reports/attendance/matrix/route.ts (new)
app/api/reports/attendance/percentage/route.ts (new)
app/admin/(shell)/reports/attendance/page.tsx
app/admin/(shell)/reports/AttendanceReportBrowser.tsx

Migration Files
Not applicable — no schema change; reuses the existing bulk effective-status RPC as-is.
Branch Name
feature/FP-129-FP-130-attendance-matrix-and-percentage
Commit Message
FP-129, FP-130: attendance yearly matrix by event type + date-range percentage report
Pull Request Description
Maps to acceptance criteria:

FP-129: "Filter by one or multiple event types" → checkbox list, eventTypeIds array through the whole chain. "Per-member yearly matrix, Present/Absent/%Present" → getAttendanceMatrixByEventType. "% = Present ÷ (Present + Absent), official attendance only" → shared fetcher's attendance_status-only sourcing. "Historical pre-adoption years empty, not a bug" → years derived from actual data, nothing synthesized.
FP-130: "Start/end date + Member/Group/Community granularity" → getAttendancePercentage's granularity param. "Group % is weighted, not averaged" → sums before dividing, documented inline. "Community Admin-tier only" → explicit FORBIDDEN_ROLE check in report.service.ts. "Zero-expected shows no-data, not 0%" → — rendering, consistent with existing report conventions.
Shared: event-type filter mechanism built once, used by both — per FP-130's explicit "don't build twice."

Jira Linkage

PDEEpicID: FP-36 (EPIC-9 — Reporting & Metrics)
PDEStoryID: FP-129, FP-130

Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-129-FP-130.md, frozen after save. npm run build must pass cleanly. Open PR against dev, do not merge. No migration, no remote step — this reuses an existing RPC as-is.
Include full diffs for every file in the completion report — not a summary. Given the size, this PR's diff will be substantial; that's expected, not a signal to trim corners.
