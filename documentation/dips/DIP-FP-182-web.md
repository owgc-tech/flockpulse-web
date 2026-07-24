Story Summary

Adds four new read-only reporting endpoints backing the mobile Dashboard tab’s two-step selection (event type, then a specific event of that type) and its three stat cards. Visibility is role-scoped: Admin-tier sees every event type and every event; everyone else sees only event types and events they’re personally invited to (event_attendees). The “default” endpoint resolves the single most recent event the viewer is allowed to see, across all types, for the landing state before any manual selection. No schema changes.

Repo Target

Web (Next.js), owgc-tech/flockpulse-web.

Grounding Check

	•	No event type is hardcoded anywhere in this version — this directly replaces an earlier draft of this same DIP that hardcoded “Community Assembly,” for the same reason FP-180 originally hardcoded two task names: a real design mistake caught before it reached Claude Code this time, not after.
	•	“Invited to” reuses the existing event_attendees WHERE member_id = ctx.memberId pattern, confirmed by reading listEventsForMember() (backing the mobile “My Events” tab) directly — not a new visibility concept invented for this story.
	•	Admin-vs-everyone-else, not Admin-vs-Leader-vs-Member — stated as an explicit interpretation, not hedged silently: both Leader-tier and Member-tier are scoped to their own event_attendees membership; only Admin-tier is unrestricted. “Invited to an event” is a personal fact, not something Leader-tier inherently has more of.
	•	The three-card stats computation itself is now fully generic — once scoped to a specific event_id, attendance/RSVP/rating aggregation doesn’t need to know or care what event type it is. Only the two dropdown-listing endpoints and the default-resolution endpoint need type/visibility awareness.
	•	“Current year” scope applies to the per-type events dropdown (matching the original story’s literal “all [X] of the current year” framing, generalized) but not to the default-event resolution — Joseph’s own wording for the default was “the latest event the user is allowed to see,” with no year qualifier. Flagging this distinction explicitly rather than silently picking one.
	•	Reused precedent: resolveMemberIdFilter() in this same file already uses a null = “unrestricted” / array = “intersect with this” convention for Admin vs. scoped callers — the new getVisibleEventIds() helper mirrors that exact convention, just keyed on event_id membership instead of member_id membership.
	•	Feedback anonymization: unchanged from the original draft — the feedback query’s SELECT list never includes member_id or any joined member field.
	•	Round-half-up via Math.round(): unchanged from the original draft.

Implementation Plan

	1.	Repository (src/features/reports/report.repository.ts) — add:
	•	getVisibleEventIds(tenantId, memberId, role): Promise<string[] | null> — null for Admin-tier; otherwise the caller’s own event_attendees.event_id list.
	•	getDashboardEventTypes(tenantId, memberId, role): Admin-tier → every active event_types row tenant-wide (reuses listEventTypes-style query). Non-Admin → only event types that have at least one event in the caller’s visible-event-id set (avoids a dropdown entry with nothing selectable behind it).
	•	getDashboardEventsForType(tenantId, memberId, role, eventTypeId): events of that type, current calendar year, start_datetime <= now(), intersected with getVisibleEventIds() for non-Admin, ordered start_datetime DESC. Returns { id, name, start_datetime }[].
	•	getDefaultDashboardEvent(tenantId, memberId, role): single most recent already-held event across all types, intersected with visibility, no year restriction; returns { event_type: {id,name}, event: {id,name,start_datetime} } | null.
	•	getDashboardStats(tenantId, memberId, role, eventId): validates the event is tenant-scoped and visible to this caller (Admin: any; non-Admin: must be in their event_attendees), then computes the same generic attendance/RSVP/rating-and-feedback three-card payload from the earlier draft — now with no type-specific resolution logic at all.
	2.	Service (report.service.ts) — thin pass-throughs for all four, no leader-scoping via resolveLeaderScope() (that function answers a different question — “which members” — not “which events”; this story’s own scoping is the new getVisibleEventIds() path instead).
	3.	API routes, all withAuth with no requireRole (open to every authenticated role, since the visibility split is enforced inside the service/repository layer, not via a route-level role gate):
	•	GET /api/reports/dashboard/event-types
	•	GET /api/reports/dashboard/events?event_type_id=
	•	GET /api/reports/dashboard/default
	•	GET /api/reports/dashboard/stats?event_id=

Files to Create/Modify

	•	src/features/reports/report.repository.ts (modify — five new functions appended)
	•	src/features/reports/report.service.ts (modify — four new pass-through functions appended)
	•	app/api/reports/dashboard/event-types/route.ts (new)
	•	app/api/reports/dashboard/events/route.ts (new)
	•	app/api/reports/dashboard/default/route.ts (new)
	•	app/api/reports/dashboard/stats/route.ts (new)

Migration Files

None.

Branch Name

feature/FP-182-web-dashboard-api

Commit Message

FP-182-web: add role-scoped event-type/event-list/default/stats endpoints for the mobile Dashboard

Pull Request Description

	•	“Choice of event type, not hardcoded to Community Assembly” → event-types and events endpoints, no type name anywhere in the code.
	•	“Admin sees everything; members see only what they’re invited to” → confirm getVisibleEventIds()’s Admin-vs-everyone-else split, and that both Leader and Member accounts get the scoped path in a quick manual check.
	•	“Default = latest visible event” → confirm the default endpoint’s response for both an Admin account and a Member account with different event_attendees histories, showing they can genuinely differ.
	•	Feedback anonymization: confirm the exact SELECT list for the feedback query in the PR description, as before.

Jira Linkage

	•	PDEEpicID: FP-36
	•	PDEStoryID: FP-182

Stop Point

Save this DIP verbatim to documentation/dips/DIP-FP-182-web.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against dev and stop. Do not merge — the user will check out the branch locally, test it, and merge manually.

Include full diffs for every file in the completion report, no elisions.
