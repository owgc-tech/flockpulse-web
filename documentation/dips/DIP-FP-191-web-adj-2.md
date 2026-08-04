DIP-FP-191-web-adj-2

Story Summary
Extends acknowledged_at from detail-only to also being present on the list
response (/api/events/mine), so mobile can show an Acknowledged/Unacknowledged
pill on My Events cards, and so the event detail screen's very first render
already has the correct value instead of flashing the wrong state briefly
before the fresh detail fetch resolves.

Repo Target
Web (Next.js), owgc-tech/flockpulse-web. Fresh branch off current dev (PR #152 already merged).

Grounding Check
- This directly closes two symptoms reported from real device testing that trace to the same root cause: acknowledged_at was deliberately scoped detail-only in the prior adj-1 DIP, on the assumption a per-row lookup for an entire list was heavier than needed. That assumption turns out to be wrong given the actual UX requirement — the list genuinely needs this per-event, not just the single-event detail view.
- Per-row lookup for a whole list needs a real design decision, not a naive per-row query: a single-event lookup (getAcknowledgedAt) already exists from adj-1; this needs a batch equivalent, following this codebase's established fetch-and-reduce convention (fetch the caller's own acknowledgement rows for the relevant event_ids in one query, build a lookup map, merge client-side) rather than a fragile embedded-relation filter through PostgREST.
- listEventsForMember already takes memberId as a parameter (it's inherently "this viewer's own events") — the batch lookup uses that same value, no new parameter needed.

Implementation Plan
1. src/features/announcements/announcement.repository.ts: new getAcknowledgedAtMap(tenantId, memberId, eventIds: string[]): Promise<Map<string, string>> — one query against announcement_acknowledgements scoped to this member and this event_id list, returned as event_id -> acknowledged_at.
2. src/features/events/service.ts's listEventsForMember: after fetching the event list, call getAcknowledgedAtMap once for the full batch of event_ids, merge acknowledged_at: string | null onto each row (null for any event_id not in the map — every non-Announcement event, and any not-yet-acknowledged Announcement).
3. Move the acknowledged_at field's type declaration from EventDetailRow up to EventListRow (it's inherited by EventDetailRow already, so detail keeps working — the field just stops being detail-exclusive).
4. getEventById's existing single-event acknowledged_at logic (adj-1) is untouched — detail fetch still resolves it fresh and correctly on its own, this is purely additive for the list.

Files to Create/Modify
- src/features/announcements/announcement.repository.ts (modify — new getAcknowledgedAtMap)
- src/features/events/service.ts (modify — listEventsForMember)
- src/features/events/event.types.ts (modify — acknowledged_at moves to EventListRow)

Migration Files
None.

Branch Name
feature/FP-191-web-adj-2-list-acknowledged-state

Commit Message
FP-191-web-adj-2: expose acknowledged_at on the list endpoint, not just detail

Pull Request Description
- Confirm /api/events/mine now returns acknowledged_at per row, correctly null for non-Announcement events.
- Confirm this didn't regress /api/events/:id's own existing acknowledged_at behavior from adj-1.
- Confirm the batch lookup is a single additional query for the whole list, not one query per row.

Jira Linkage
- PDEEpicID: FP-188
- PDEStoryID: FP-191

Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-191-web-adj-2.md. Branch off current dev. Open a PR against dev and stop. Do not merge.

Include full diffs for every file in the completion report, no elisions.
