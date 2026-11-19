DIP-FP-119
Story Summary
Adds a durable, always-available way to self-report for a completed event, backstopping FP-97's local notification (which is only reachable once, by tapping it). New third mobile tab, "Self-Report," visible to every role, listing events the member is expected at, completed but not yet locked, not cancelled, and not already self-reported — same badge/pull-to-refresh treatment as Confirmations. Web needs one new endpoint; mobile needs the new tab plus a restructured, combined badge sync (see Grounding Check).
Repo Target
Both — new backend endpoint (web) + new tab (mobile). Two DIPs below, clearly labeled, per the cross-app convention.
Grounding Check

Confirmed live: no existing endpoint returns "my events, completed-not-locked, not cancelled, not yet self-reported" — genuinely new query, not a UI-only addition.
Confirmed the existing listEventsForMember() pattern (event_attendees → events → attachEffectiveStatus()) is the right base to model the new query on — but attachEffectiveStatus is currently a private, unexported function in events/service.ts. Needs exporting for reuse rather than duplicating status-derivation logic in a second place.
Confirmed filtering to exactly effective_status === 'COMPLETED' already excludes CANCELLED correctly, without needing a separate explicit exclusion — cancelled events carry CANCELLED as their effective status regardless of timing (per FP-66's "stays visible regardless of timing" AC), so they never satisfy === 'COMPLETED' in the first place. Confirmed, not assumed.
Confirmed member_attendance_reports (self-reports table) and getExistingSelfReport()-style existence check already exist — the new query needs an equivalent bulk exclusion (events already reported) rather than a single-event check.
Real technical constraint, not a nice-to-have: Notifications.setBadgeCountAsync() sets the OS icon badge to an absolute number — it doesn't add. FP-99's confirmationBadge.service.ts already calls this independently for Confirmations' count. If this story's self-report badge sync also calls it independently, whichever sync runs last silently overwrites the other's number rather than the two combining — meaning the OS icon would show only one tab's count, not the true total. This needs a shared combining layer, not a second independent copy of FP-99's pattern.
No Section 4 invariant rules touched — this doesn't change self-report's own validation/rules, RSVP semantics, or attendance lifecycle; it's purely a new read path plus a new list surface.

Implementation Plan — Web (owgc-tech/flockpulse-web)

src/features/events/service.ts — export attachEffectiveStatus (currently private) so it can be reused here without duplicating status-derivation logic.
New src/features/self-reports/self-report.types.ts addition (or new file) — PendingSelfReportRow { event_id, event_name, event_start_datetime, event_end_datetime, event_location_name }.
New function in self-report.repository.ts — getPendingSelfReports(tenantId, memberId):

Fetch event_attendees rows for memberId (same shape as listEventsForMember).
Fetch those events (id, name, start_datetime, end_datetime, location_name, status), run through the now-exported attachEffectiveStatus.
Filter to effective_status === 'COMPLETED'.
Fetch existing member_attendance_reports rows for this memberId across those event ids; exclude any event already reported.
Return the remaining rows shaped as PendingSelfReportRow[].


New app/api/self-reports/pending/route.ts — GET, withAuth only (no role restriction — every member can hit this for themselves), calls getPendingSelfReports(ctx.tenantId, ctx.memberId).
Run npm run build, show full diff.

Branch: feature/FP-119-web-pending-self-reports. Commit: FP-119-web: add GET /api/self-reports/pending. Save documentation/dips/DIP-FP-119-web.md verbatim, PR against dev, don't merge.
Implementation Plan — Mobile (owgc-tech/flockpulse-mobile)

src/features/self-reports/services/selfReports.service.ts — add listPendingSelfReports() wrapping the new endpoint.
Combined badge architecture (addresses the Grounding Check constraint above): restructure so both badge sources feed one shared OS-icon total.

New src/features/notifications/services/selfReportBadge.service.ts — syncSelfReportBadgeCount(): fetches listPendingSelfReports(), pushes the count into a new shared store entry (mirroring useConfirmationBadgeCount's pattern), returns the count.
Add a small combining function (e.g. in a shared badge-store module) that, whenever either count updates, recomputes Notifications.setBadgeCountAsync(confirmationCount + selfReportCount) — the OS icon reflects the sum; the two tabBarBadge values on the two tabs stay independent, each showing its own count.
confirmationBadge.service.ts's existing syncConfirmationBadge() needs adjusting to go through this same combining step rather than calling setBadgeCountAsync directly on its own.


New app/(app)/(tabs)/self-report/index.tsx — mirrors confirmations/index.tsx structure: FlatList + RefreshControl + badge resync on refresh, but each card shows only event name/date-time/location (no inline buttons) and taps through to the existing events/[id]/self-report route (reuse as-is, no new form).
app/(app)/(tabs)/_layout.tsx — add the third Tabs.Screen, no href gating (visible to every role, unlike Confirmations), tabBarLabel: "Self-Report", tabBarBadge wired to the new count, sync call added alongside the existing Confirmations sync in the mount/foreground useEffect.
Run npx tsc --noEmit, show full diff.

Branch: feature/FP-119-mobile-self-report-tab. Commit: FP-119-mobile: add Self-Report tab with combined badge sync. Save documentation/dips/DIP-FP-119-mobile.md verbatim, PR against dev, don't merge.
Migration Files
None — no schema changes on either side.
Jira Linkage

PDEEpicID: FP-18
PDEStoryID: FP-119

Stop Point
Both PRs open against dev, neither merged — I review, you merge, test web first (the endpoint) then mobile (depends on it being live).
