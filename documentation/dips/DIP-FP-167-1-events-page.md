DIP-FP-167-1-events-page.md
Story Summary
Phase 1 of 2 for FP-167. Redesigns the admin Events page: sticky title/create-button/filter band, filters for Type/Month/Status, and infinite scroll — starting here since Events is the more complex of the two (three filters vs. two, and the Type filter depends on the event_types catalog).
Repo Target
Web only.
Grounding Check

Confirmed live: listEvents(tenantId) has zero pagination — fetches every event in the tenant unconditionally, ordered by start_datetime. This DIP adds real cursor/offset-based pagination to the backend, not just a client-side infinite-scroll wrapper around an already-small dataset.
event_types catalog (FP-161 Phase 1) is the source for the Type filter — reuse listTasks-equivalent listEventTypes as-is.
Status filter uses effective status (attachEffectiveStatus), same derivation used everywhere else in this app.

Implementation Plan

listEvents(): add limit/offset (or cursor) params, plus optional filters (eventTypeIds?: string[], month?: string, status?: string[]) applied at the query level where possible (event_type_id, start_datetime range are real columns; effective status requires the existing attachEffectiveStatus + filter-after-fetch pattern, same as other functions this session).
app/api/events/route.ts GET: accept these as query params, pass through.
EventsTable.tsx/page.tsx: sticky header (title + Create Event button + filter bar) via CSS position, independently-scrolling list beneath it; Type (multi-select), Month (single picker), Status filters; infinite scroll triggering additional fetches as the user nears the bottom of loaded rows; filter state reflected in the URL.
Verify at DIP time whether list virtualization is warranted given this app's realistic event counts, or whether straightforward DOM append is sufficient — implementer's call, not dictated here.

Files to Create/Modify

src/features/events/service.ts, app/api/events/route.ts
app/admin/(shell)/events/EventsTable.tsx, page.tsx
New filter component(s)

Branch Name
feature/FP-167-1-events-page
Jira Linkage

PDEEpicID: FP-11
PDEStoryID: FP-167

Stop Point
Save verbatim to documentation/dips/DIP-FP-167-1-events-page.md, frozen after save. npm run build must pass cleanly. Open PR against dev, do not merge. No migration — no schema change, purely query/UI.
Include full diffs in the completion report.
