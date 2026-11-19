DIP-FP-140.md
Story Summary
Both the RSVP report and the Attendance report have an Event dropdown listing every event flatly by name, with no date shown — since events can repeat (recurring series), same-named occurrences are indistinguishable in the picker. This DIP adds a Date-only picker before the Event dropdown on both screens, filtering the dropdown's options to events starting on that date. It's a pure client-side UX aid — no new report parameter, nothing new submitted to either report's query. Both components need the same date-comparison logic, so it's extracted into one small shared helper; the surrounding UI stays in each component separately since the two aren't structurally identical (Attendance already has its own, unrelated dateFrom/dateTo range filter — a different feature covered below).
Repo Target
Web (Next.js) — owgc-tech/flockpulse-web. No mobile equivalent of either report screen exists — confirmed via prior sessions' grounding, not re-verified here since it hasn't changed.
Grounding Check
Confirmed live against dev:

Both RsvpReportBrowser.tsx and AttendanceReportBrowser.tsx receive events: Option[] where Option = { id: string; name: string } — no date. Both are populated identically in their respective page.tsx files via listEvents(tenantId).map(e => ({ id: e.id, name: e.name })), discarding the start_datetime that listEvents() already selects.
AttendanceReportBrowser.tsx already has an unrelated dateFrom/dateTo range filter, submitted as date_from/date_to query params to the report itself. This is a different feature — a server-side report range filter, not an event-picker aid. The new field must be visually and functionally distinct (labeled "Event Date", not "Date", to avoid confusion with the existing "Date From"/"Date To" fields on that same screen) and must never be submitted as a query param — it only ever filters the client-side events array passed to the dropdown.
No shared date-utility file exists anywhere in the web repo — date formatting elsewhere (EventsTable.tsx) is done ad hoc via plain Date methods (toLocaleString()), no library. The new shared helper follows this same no-dependency convention rather than introducing one.
Local-date comparison, not UTC: <input type="date"> yields a plain YYYY-MM-DD string with no timezone. Comparing it correctly against an event's start_datetime requires extracting the local calendar date from that ISO string (getFullYear()/getMonth()/getDate(), matching how EventsTable.tsx already displays dates in local time via toLocaleString()) — not toISOString()'s UTC-based Y/M/D, which would misattribute events near midnight to the wrong day. This is the one piece of logic worth sharing between the two components, since it's genuinely identical and the fiddliest part to get right.
Design decision (per the story's explicit "decide at DIP time"): Event dropdown shows all events until a date is picked — matches current behavior exactly when the field is untouched, lowest-risk, easiest to verify live. Not gating the dropdown behind a mandatory date pick.
Shared-helper decision (per the story's explicit prompt): a small pure function, not a shared hook or component. The two report components differ enough elsewhere (Attendance has status columns/colors and its own date-range fields; RSVP has summary-row aggregation) that forcing a shared UI abstraction would fight their existing separate structures for no real benefit. Only the date-comparison logic is genuinely duplicated, so only that moves into src/lib/dateFilter.ts.
UX corollary, not in the original AC but a natural consequence of narrowing: if an event is already selected and a newly-picked date excludes it from the filtered list, the selection is cleared — leaving a hidden, no-longer-visible event selected would be confusing. Flagging this explicitly since it's an added behavior, even though it's small.
Domain rules: no conflict — pure reporting UI, no new report semantics.

Implementation Plan

New file src/lib/dateFilter.ts: toLocalDateString(isoDatetime: string): string (local Y-M-D, zero-padded) and filterByLocalDate<T extends { start_datetime: string }>(items: T[], dateStr: string): T[] (returns items unchanged if dateStr is empty, otherwise filters to matching local dates).
app/admin/(shell)/reports/rsvp/page.tsx: extend eventOptions mapping to include start_datetime: e.start_datetime.
RsvpReportBrowser.tsx: add EventOption type ({ id, name, start_datetime }), change Props.events to EventOption[]. Add eventDate state (empty string default). Add a "Event Date" <input type="date"> before the existing Event <select>. Compute visibleEvents = filterByLocalDate(events, eventDate) and map that instead of events directly in the dropdown. On eventDate change, if the current eventId isn't in the newly-computed visibleEvents, reset eventId to ''.
app/admin/(shell)/reports/attendance/page.tsx: identical mapping extension to step 2.
AttendanceReportBrowser.tsx: identical treatment to step 3 — new EventOption type, new eventDate state, new "Event Date" input placed immediately before the Event dropdown (visually separated from the existing "Date From"/"Date To" fields, which stay exactly as they are, untouched, still submitted as query params). Same selection-reset behavior on narrowing.

Files to Create/Modify

src/lib/dateFilter.ts (new)
app/admin/(shell)/reports/rsvp/page.tsx
app/admin/(shell)/reports/RsvpReportBrowser.tsx
app/admin/(shell)/reports/attendance/page.tsx
app/admin/(shell)/reports/AttendanceReportBrowser.tsx

Migration Files
Not applicable — no schema change, listEvents() already returns start_datetime.
Branch Name
feature/FP-140-report-event-date-filter
Commit Message
FP-140: add Event Date filter to narrow the Event dropdown on RSVP and Attendance reports
Pull Request Description
Maps to acceptance criteria:

"Date-only picker before the Event dropdown on both reports" → new "Event Date" input on both RsvpReportBrowser.tsx and AttendanceReportBrowser.tsx.
"Narrows to events starting that day, local calendar date not UTC" → toLocalDateString()/filterByLocalDate() in the new shared helper.
"Dropdown behavior when no date picked" → shows all events, matching current behavior unchanged.
"Clearing the date resets to full list" → filterByLocalDate returns the unfiltered array when eventDate is empty.
"No change to what's submitted / how either report filters" → event_id submission logic untouched in both components; the new field is never added to either's URLSearchParams.
"Distinct from Attendance's existing Date From/To" → labeled "Event Date", visually separate, no interaction with the existing range-filter state or query params.

Jira Linkage

PDEEpicID: FP-36 (EPIC-9 — Reporting & Metrics)
PDEStoryID: FP-140

Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-140.md, frozen after save. npm run build must pass cleanly. Open PR against dev, do not merge. No migration, no remote step.
Include full diffs for every file in the completion report — not a summary.
