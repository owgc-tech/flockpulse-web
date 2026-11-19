### DIP — FP-222 (Web, part 1 of 2): Server support for Needs Attention and Recently Modified

### Not covered — deliberately excluded
- Mobile UI (card badges, the Events tab badge count, calling the view endpoint): part 2, written after this is merged.
- Web admin screens: no indicators there.
- Push or local notifications: out of scope per the ticket.
- A separate signal for a task that lost its only assignee: not in v1; Recently Modified covers "something changed".
- Any change to what bumps events.version: FP-221 and FP-234 already bump it on task changes and event-field edits.

### Story Summary
Two indicators for the mobile Events tab cards need server support. (1) Needs Attention: shown only to the event's owner and to Admins when a current assignee has refused a task on that event (FP-221). (2) Recently Modified: shown to anyone with access when the event's content changed since that person last opened it; this needs a new per-member, per-event record of the last version the member viewed. Add the two flags to the event list and detail responses, add the view tracking and its endpoint, make sure the person who made a change never sees it as "modified", and clean up per-person view rows on removal.

### Repo Target
Web (Next.js and one Supabase migration). Part 2 (mobile) follows.

### Grounding Check
Verified this session, not assumed:
- Live ticket FP-222 (Epic FP-31) defines the rules above: Needs Attention is owner and Admins only, driven by outstanding refusals from CURRENT assignees, clears when the refuser is replaced or changes to Commit, owner is events.owner_member_id, older events with no owner are Admin-only; Recently Modified is driven by events.version versus the viewer's last-viewed version, is NOT part of any badge, and a refusal on its own is not a modification; the last-viewed record is written when the member opens the event detail screen.
- event_task_assignment_responses (migration 20261003000073): tenant_id, assignment_id (nullable, SET NULL), event_id (nullable, SET NULL), task_id, member_id, status IN ('COMMITTED','REFUSED'), responded_at, is_current, cleared_at, cleared_reason. History rows have is_current = false and must be ignored. FP-221 and FP-234 clear a response when the person is replaced, removed or changes their mind.
- events has owner_member_id (migration 20260720000052) and a version column (verify its definition and exactly which functions bump it: update_event_with_audit for event-field edits, and bump_event_version_for_task_change, which RETURNS VOID, for task changes).
- src/features/events/service.ts: listEventsForMember adds is_attendee at about line 715 and getEventById at about line 772; the row type is in src/features/events/event.types.ts (about line 68); routes: app/api/events/mine/route.ts (list), app/api/events/[id]/route.ts (detail). Visibility today: Admin tier sees all non-draft events of the tenant, a Leader sees owned plus invited events, a Member sees invited events (FP-223).
- remove_member() (migration 20261004000079, FP-237) is the removal routine and must clean up every LIVE per-person table.
- FP-228 convention: new tables are API-only (RLS on, no policies, nothing granted to anon or authenticated); functions are closed to PUBLIC, anon and authenticated and granted to service_role only. Standing rules: cross-tenant trigger on new tables with foreign keys, canonical error codes from Engineering Spec section 6 (check before inventing).
- Re-verify all of this first.

### Implementation Plan
1. Migration 20261005000080_event_member_views.sql (confirm the next free number):
   a. Table event_member_views: tenant_id, event_id, member_id, last_seen_version INT NOT NULL, last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (event_id, member_id); foreign keys to events and members; BEFORE INSERT OR UPDATE trigger validating that the event and the member belong to the row's tenant; FP-228 privilege conventions.
   b. Function record_event_view(p_tenant_id, p_event_id, p_member_id, p_version) SECURITY DEFINER, service_role only: INSERT ... ON CONFLICT (event_id, member_id) DO UPDATE with last_seen_version = GREATEST(existing, new) so a stale or lower version never lowers the stored one; last_seen_at = now().
   c. Replace remove_member() (CREATE OR REPLACE, based on the CURRENT definition in migration 20261004000079, changing nothing else) so removal also deletes the member's event_member_views rows, on every branch. One-time idempotent cleanup of the same for members already removed (expected: none yet).
2. Service: recordEventView(tenantId, memberId, eventId, version?) (reads events.version when omitted and never stores a version above the event's current one). Flag computation for BOTH the list and the detail response, batched with no per-event queries:
   - needs_attention: true only when the caller is the event's owner (events.owner_member_id = caller) or Admin tier, AND the event has at least one current refusal (event_task_assignment_responses with is_current AND status = 'REFUSED' AND event_id set AND assignment_id set) AND the event is not cancelled, draft or ended (use the effective-status data the list already works with). For everyone else it is false.
   - is_modified: true only when the caller has an event_member_views row for the event AND events.version is greater than last_seen_version. No row means false (a first-time viewer sees no indicator).
   Add both booleans to the list and detail row types alongside is_attendee. The detail response returns the flags as they are BEFORE the view is recorded; recording is a separate call.
3. Route POST /api/events/[id]/view (new): same authentication wrapper and the same access rule as opening that event's detail (anyone who may open it, nobody else; use the canonical error codes for not allowed and not found); body { version?: number }; calls recordEventView; returns 204. Safe to call repeatedly.
4. The editor never sees their own change as "modified": after a SUCCESSFUL event edit and after every successful task-assignment write that bumps the version (create, update, delete, auto-assign), record a view for the ACTOR (the authenticated member) at the event's new version (read events.version after the write). This must be best-effort: a failure here is logged and must never fail the edit.
5. Tests (a script under scripts/, local database, real service code):
   - Needs Attention: a refusal gives true for the owner and for an Admin and false for a Leader who is not the owner, for a Member, and for the refuser; two refusals still true; the refuser changes to Commit gives false; the refuser is replaced gives false; the refuser is removed (FP-234 and FP-235 path) gives false; an event with no owner is Admin-only; a cancelled or ended event gives false; history rows (is_current false) are ignored.
   - Recently Modified: never opened gives false; open, then edit an event field gives true; open again gives false; a task reassignment gives true; a refusal alone gives false; the editor does not see their own edit or their own task change as modified; a lower version posted later never lowers the stored version; a version above the event's current one is clamped; a caller without access to the event is rejected; a cross-tenant event is rejected.
   - Plumbing: list and detail carry the same flags for Admin, Leader and Member; the number of database queries per list request does not grow with the number of events.
   - remove_member() deletes the removed member's view rows; the FP-228 privilege check returns zero rows; existing test scripts match their baselines.
6. Validate locally first (supabase start and supabase db reset). Never apply the migration to the remote database.

### Files to Create/Modify
- supabase/migrations/20261005000080_event_member_views.sql (new; confirm the next free number)
- src/features/events/service.ts and src/features/events/event.types.ts (modify)
- app/api/events/[id]/view/route.ts (new)
- The event edit path and every task-assignment write path that bumps the version (list each file you touch for the editor rule)
- scripts/test-fp222-*.ts (new)

### Migration Files (if applicable)
One migration as described, written to disk and validated locally only.

### Branch Name
feature/FP-222-web-event-indicator-flags

### Commit Message
FP-222-web: needs_attention and is_modified flags and event view tracking

### Pull Request Description
Maps to FP-222's server-side criteria: the Needs Attention rules for owner and Admins, the Recently Modified rule driven by events.version versus last viewed, the new last-viewed tracking, and both flags available together on the same event. Include the test results above, the response shape with an example for each role, how the editor rule was implemented and which files it touches, and what you could not test.

### Jira Linkage
- PDEEpicID: FP-31
- PDEStoryID: FP-222 (part 1 of 2)

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-222-web.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Branch off current dev and open the PR with gh pr create --base dev; quote the base in your report and do NOT stack it on any other branch. Do not apply the migration to any remote database. Do not merge. Joseph applies the migration after review, then merges.

Include full diffs for every file in your completion report per Section 5, rule 12, not a summary.
