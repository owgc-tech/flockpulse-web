DIP-FP-191-web-adj-1

Story Summary
Two fixes surfaced by real device testing. First: adds a creator field to events (currently untracked anywhere queryable) so the mobile Announcement card/detail screen can show who posted it, replacing the current confusing behavior where placeholder location values ('Announcement'/'N/A', forced server-side to satisfy a NOT NULL constraint) leak into the UI as a non-functional "open maps" link. Second: exposes whether the current caller has already acknowledged a given event, so the mobile Acknowledge button can correctly reflect true persisted state on every visit, not just within the same screen session.

Repo Target
Web (Next.js), owgc-tech/flockpulse-web. Fresh branch off current dev (PR #151 already merged).

Grounding Check
- Confirmed by direct search: events has no created_by column today — creator identity only exists implicitly as the actor_member_id passed to write_audit_log() at creation time, not queryable off the row itself.
- Confirmed by re-reading PR #78's own AnnouncementSection: isAcknowledged is local useState(false), never initialized from any server value — CC's own documented reasoning was that no field existed to initialize it from. This DIP closes that exact gap rather than asking mobile to work around it differently.
- The location_name='Announcement'/location_address='N/A' placeholder values are NOT being removed — still required server-side to satisfy the real NOT NULL constraint. This fix is about the API exposing creator identity so mobile has something better to render instead; the placeholder values themselves are untouched.
- created_by is a genuinely generic addition (useful for any event, not Announcement-specific) — populated for all future events; existing rows backfill to NULL.
- The Check-In tab is unaffected by the acknowledgement-persistence gap — it only ever lists not-yet-acknowledged items in the first place, so an acknowledged announcement already drops out of that list correctly. This fix is specifically about the event detail screen, reached via My Events or a reminder tap, which has no other source of truth to initialize from.

Implementation Plan
1. Migration: events.created_by UUID REFERENCES members(id) (nullable). insert_event_with_audit's INSERT statement sets created_by = p_actor_member_id (no RPC signature change — p_actor_member_id is already a parameter).
2. Extend /api/events/mine and /api/events/:id with a nested created_by_member: { id: string; first_name: string; last_name: string } | null object, joining against members. Mirrors the existing event_type nested-object pattern for consistency. Null for pre-existing events or a future anonymized/deleted creator.
3. Extend /api/events/:id specifically (not the list endpoint — this is a single-event concern) with acknowledged_at: string | null, reflecting whether the current authenticated caller (ctx.memberId) has an existing row in announcement_acknowledgements for this event_id. Null if not yet acknowledged by this caller.

Files to Create/Modify
- supabase/migrations/[next]_events_created_by.sql (new)
- src/features/events/service.ts (modify — insert_event_with_audit's INSERT statement, mine/detail query joins, detail query's acknowledged_at lookup)

Migration Files
Full SQL at implementation time: ALTER TABLE events ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES members(id); extend insert_event_with_audit's INSERT column list to include created_by, value p_actor_member_id.

Branch Name
feature/FP-191-web-adj-1-announcement-creator-and-ack-state

Commit Message
FP-191-web-adj-1: add events.created_by and per-caller acknowledged_at to event detail

Pull Request Description
- Confirm a freshly created event has created_by populated, a pre-existing event returns created_by_member: null.
- Confirm /api/events/:id's acknowledged_at correctly reflects true state: null before acknowledging, a real timestamp after, for the calling member specifically (not any member).
- Confirm the field shapes match DIP-FP-191-mobile-adj-1 exactly.

Jira Linkage
- PDEEpicID: FP-188
- PDEStoryID: FP-191

Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-191-web-adj-1.md. Branch off current dev. Open a PR against dev and stop. Do not merge.

Include full diffs for every file in the completion report, no elisions.
