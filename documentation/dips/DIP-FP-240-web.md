### DIP — FP-240 (Web): Everyone who can open an event sees the full RSVP roster; reasons restricted; removed members hidden

### Not covered — deliberately excluded
- The mobile UI: the mobile DIP follows after this ships.
- Reports (RSVP Report, Attendance Report and every other report) and ALL web admin pages: unchanged, including how the web admin event page uses the roster function.
- Announcement events' acknowledgement roster: unchanged.
- Any migration or schema change.

### Story Summary
Decision by Joseph (FP-240, 2026-10-05): the RSVP summary (roster) on the mobile Event Detail no longer depends on the viewer's role. Today GET /api/events/:id/roster requires the Leader tier and scopes a Leader to their assigned members, so a Member gets a 403. New rules for that endpoint: (1) every person who may open the event, Member, Leader or Admin, gets the FULL invited roster with name, response and guest count; (2) a person's decline reason (rsvp_reason) is returned ONLY to Admin tier, to the leader of that person, and to the person themself; for every other viewer it is null; (3) removed members (members.deleted_at set) are NOT returned, for past and upcoming events.

### Repo Target
Web (Next.js). No migration.

### Grounding Check
Verified this session, not assumed (re-verify first):
- app/api/events/[id]/roster/route.ts: GET wrapped in withAuth(req, requireRole('LEADER')(...)), calling getEventRoster(id, ctx.tenantId, isExactlyLeaderTier(ctx.role) ? ctx.memberId : undefined); NOT_FOUND maps to 404.
- src/features/events/service.ts: getEventRoster(eventId, tenantId, scopeToLeaderMemberId?) reads event_attendees joined to members(first_name, last_name) and rsvps (rsvp_status, rsvp_reason, guest_count) and returns RosterEntry { member_id, first_name, last_name, response ('ACCEPTED' | 'DECLINED' | 'TENTATIVE' | 'NOT_RESPONDED'), rsvp_reason, guest_count }; when scopeToLeaderMemberId is given it filters by getMembersAssignedToLeader (FP-95). Find EVERY caller of getEventRoster (the web admin event page, tests, others) and keep their behavior unchanged.
- Access rule to reuse: recordEventViewForCaller in the same service (FP-222) already implements "may this caller open this event": Admin tier any event; Leader tier events they own or are invited to; Member events they are invited to; canonical errors FORBIDDEN_SCOPE (403) and NOT_FOUND (404). The detail endpoint itself has no per-event check (FP-239); do not copy that gap.
- getMembersAssignedToLeader (src/features/assignments/service.ts) returns the leader's active assigned members (FP-237, removed members excluded). isAdminTier and isExactlyLeaderTier are in src/lib/auth/middleware.
- Re-verify all of this first.

### Implementation Plan
1. Extract the existing "caller may open this event" logic into one small shared function (for example assertCallerCanOpenEvent) used by BOTH the view endpoint and the roster route, with identical behavior and error codes; do not change the view endpoint's behavior.
2. Roster route: replace requireRole('LEADER') with plain authentication (any authenticated member with a member id), call the shared access check first, then getEventRoster with new options. Responses stay { data: RosterEntry[] }.
3. getEventRoster gets an options argument, with a default that preserves today's behavior for every existing caller: { viewer?: { memberId, role }, hideRemoved?: boolean }. The roster route passes viewer = the caller and hideRemoved = true and NO scopeToLeaderMemberId. When viewer is omitted, behavior is exactly as today (so the web admin page is unaffected).
4. With hideRemoved true, exclude members whose members.deleted_at is not null (filter on the joined members row; make sure an attendee row whose member is removed is dropped, not returned with null names).
5. With viewer provided, set rsvp_reason to null unless: the viewer is Admin tier, or viewer.memberId equals the row's member_id, or the row's member is in the viewer's assigned members (computed ONCE per request from getMembersAssignedToLeader when the viewer is a Leader-tier caller). Leader tier means the leader of that decliner, not any leader. guest_count and response are always returned.
6. Update the existing tests that assert leader scoping (FP-95) and the Member 403; add the new tests below.
7. Standing rules: tenant id comes only from the authenticated token; canonical error codes only.

### Files to Create/Modify
- app/api/events/[id]/roster/route.ts (modify)
- src/features/events/service.ts (modify: shared access function, getEventRoster options)
- The existing roster and FP-95 test scripts (update) and a new test script, for example scripts/test-fp240-roster-visibility.ts

### Migration Files (if applicable)
None.

### Branch Name
feature/FP-240-web-roster-visible-to-all

### Commit Message
FP-240-web: roster visible to everyone who can open the event; reasons restricted; removed members hidden

### Pull Request Description
Maps to FP-240's web criteria. Include the test results for: an invited Member gets the full roster and sees no other person's reason, but sees their own; a Member who is not invited gets 403 or 404; a Leader gets the full roster and sees reasons only of their own assigned decliners; an Admin gets everything including all reasons; removed members are absent for a past and for an upcoming event; the web admin caller of getEventRoster returns exactly what it returned before (removed members included, no redaction); cross-tenant event rejected; the view endpoint still behaves identically; roster order and guest_count unchanged; existing scripts match their baselines; tsc and eslint clean. State what you could not test.

### Jira Linkage
- PDEEpicID: FP-15
- PDEStoryID: FP-240

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-240-web.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Branch off current dev and open the PR with gh pr create --base dev; quote the base in your report and do NOT stack it on any other branch. Do not merge. Joseph merges after review.

Include full diffs for every file in your completion report per Section 5, rule 12, not a summary.
