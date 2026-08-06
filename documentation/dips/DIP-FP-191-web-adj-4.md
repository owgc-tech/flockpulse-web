DIP 1 of 2 — Web
Story Summary

Announcement-type events currently have no Admin/Leader-facing view of who has acknowledged them. Mobile's event detail screen reuses /api/events/:id/roster, which is deliberately RSVP-only (FP-67) — Announcements never create rsvps rows, so every recipient shows as "no response," even after they've genuinely acknowledged. This DIP adds a new, Announcement-scoped roster endpoint that returns each targeted member's acknowledgement status, mirroring getEventRoster()'s existing pattern exactly but joined against announcement_acknowledgements instead.

Repo Target

Web (Next.js) — this is the backend/API half of a two-repo fix; mobile's DIP (2 of 2) consumes this endpoint.

Grounding Check

Confirmed live against owgc-tech/flockpulse-web dev:

GET /api/events/:id/roster (app/api/events/[id]/roster/route.ts) is explicitly commented as "Strictly RSVP-scoped (FP-67 Design Decision)... no self-report or attendance data." Extending it would contradict a documented, deliberate decision — a sibling endpoint is the correct fit, not a scope violation.
getEventRoster() (src/features/events/service.ts:938) is the pattern to mirror: fetch event_attendees for the event (this is the schema's actual materialized-attendee table — confirmed against the invariant naming note that the spec's event_expected_members doesn't exist; the real table is event_attendees), scope it to getMembersAssignedToLeader()'s member set when a Leader-tier caller is scoped, then left-join a second table by member_id to fill in status.
announcement.repository.ts already has AnnouncementAcknowledgementRow, createAnnouncementAcknowledgement, isAnnouncementEvent, getAcknowledgedAt, and getAcknowledgedAtMap — all caller-scoped (a member checking their own status). None of these return a full per-event roster. This confirms the gap is real, not an oversight in a place I hadn't checked.
acknowledgeAnnouncement() (announcement.service.ts) is the pattern to mirror for validation order: event exists (NOT_FOUND) → is actually an Announcement (INVALID_TARGET) — both canonical codes already in use on the existing POST .../acknowledge route, reused here rather than inventing new ones (Section 5.6).
No RSVP/attendance invariant is touched — announcement_acknowledgements remains structurally separate from rsvps/attendance, per FP-191's original non-negotiable.
No migration needed — announcement_acknowledgements and event_attendees both already exist.
Implementation Plan
src/features/announcements/announcement.repository.ts
Add AnnouncementRosterEntry interface: { member_id: string; first_name: string; last_name: string; acknowledged_at: string | null }.
Add getAnnouncementRoster(eventId: string, tenantId: string, scopeToLeaderMemberId?: string): Promise<AnnouncementRosterEntry[]>, structured exactly like getEventRoster(): fetch event_attendees (member_id, members(first_name, last_name)) for the event/tenant, scope via getMembersAssignedToLeader() when scopeToLeaderMemberId is provided (same assignedIds filter pattern), fetch announcement_acknowledgements (member_id, acknowledged_at) for the event/tenant, map by member_id, and return each attendee with acknowledged_at ?? null.
src/features/announcements/announcement.service.ts
Add getAnnouncementAcknowledgementRoster(tenantId, eventId, scopeToLeaderMemberId?): reuse getEventExistsForTenant → NOT_FOUND, then isAnnouncementEvent → INVALID_TARGET (same two checks and order as acknowledgeAnnouncement, minus the per-member isExpectedAttendee check since this is an Admin/Leader viewing everyone, not a member acting on their own behalf). Then call the repository function.
New file: app/api/announcements/[eventId]/roster/route.ts
GET, requireRole('LEADER'), same isExactlyLeaderTier(ctx.role) ? ctx.memberId : undefined scoping as /api/events/:id/roster — copy that route's structure closely.
Catch NOT_FOUND → 404, INVALID_TARGET → 422, rethrow anything else.
Files to Create/Modify
src/features/announcements/announcement.repository.ts (modify)
src/features/announcements/announcement.service.ts (modify)
app/api/announcements/[eventId]/roster/route.ts (new)
Migration Files (if applicable)

None — no schema changes.

Branch Name

feature/FP-191-web-adj-4-announcement-acknowledgement-roster

Commit Message

FP-191-web-adj-4: add Admin/Leader acknowledgement roster endpoint for Announcements

Pull Request Description

Adds GET /api/announcements/:eventId/roster, an Announcement-scoped equivalent of the existing RSVP roster endpoint, returning each targeted member's acknowledged_at status. Fixes the underlying data gap behind the mobile Announcement detail screen showing "no response" for everyone regardless of actual acknowledgement (see paired mobile DIP, FP-191-mobile-adj-5). No changes to the existing RSVP roster endpoint or any RSVP/attendance table.

Jira Linkage
PDEEpicID: FP-188
PDEStoryID: FP-191
Stop Point

Save this DIP verbatim to documentation/dips/DIP-FP-191-web-adj-4.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against dev and stop. Do not merge — the user will check out the branch locally, test it against the deployed dev environment, and merge manually.

Include full diffs for every file in your completion report per Section 5, rule 12 — not a summary.
