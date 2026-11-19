DIP-FP-14
Story Summary
Allows an Admin to update an already-scheduled event (details, timing) after creation. Every update increments the event's version counter and triggers a change notification to all expected members. Certain immutable fields can no longer be edited once notifications referencing them have gone out, and if the update reschedules timing, any unsent notification schedule rows need their scheduled_at recalculated rather than firing at stale times.
Repo Target
Web — owgc-tech/flockpulse-web, dev branch convention. Event management is admin-surface, web-only per Section 3.
Grounding Check
Cross-checked against live Jira (FP-14, parent FP-11/EPIC-3) and Epics & Stories v3 JSON — verbatim match. No conflict with Section 4 invariants (this story doesn't touch RSVP/self-report/attendance domains at all).
One scope note, not a blocker: "Immutable fields cannot be edited after notifications have been sent" requires knowing which fields are immutable post-notification. The Engineering Spec's PATCH /events/:eventId contract lists editable fields (name, description, start_datetime, end_datetime, location_name, location_address, location_url, target, talk_id) but doesn't explicitly classify any of them as becoming immutable post-notification — it only says "Immutable fields cannot be edited after notifications have been sent" as a general rule (STORY-3.3 AC) without naming the fields. Reading this against the rest of the spec, the only field unambiguously requiring lock-after-notification is talk_id (formation linkage — changing which Talk an event counts toward after members have been notified and potentially already attended would corrupt formation credit retroactively, which Section 4 Rule 4 treats as sacrosanct). I'm treating talk_id as the one explicitly-immutable-post-notification field and implementing the rest as editable-with-reschedule-recalculation. Flagging this interpretation in the PR description rather than silently assuming it.
Implementation Plan
Phase 0

Branch feature/FP-14-event-update-notifications off dev.
Check documentation/dips/ for any prior DIP file (DIP-STORY-3.3.md or similar) from the earlier Gemini workflow — none expected based on the remediation's prior-DIP inventory (only 1.1/1.2, 2.1/2.2, 3.1 existed), but verify before assuming clean slate.
Persist this DIP verbatim to documentation/dips/DIP-FP-14.md.

Phase 1 — Schema
4. Write supabase/migrations/20260629000004_event_update_versioning.sql:

Confirm events.version column exists (it's listed in the Engineering Spec's data model under events; verify it was actually created in 20260629000002, add it via ALTER TABLE in this migration if missing — do not assume).
No new tables required. notification_schedules (from FP-12's implementation) already has scheduled_at; this story only needs to recalculate existing rows, not add columns.
Add a partial index on notification_schedules (event_id, status) WHERE status IN ('pending','retrying') if not already present, to make the "recalculate unsent schedules on reschedule" query efficient — check before adding to avoid a duplicate index.


supabase db reset to validate.

Phase 2 — Application layer
6. PATCH /api/events/[id]/route.ts (or extend the existing route from FP-12 if one exists — check first):

Validate caller is Admin (reuse src/lib/auth/middleware.ts from the remediation).
Validate event is in a state where updates are permitted (not LOCKED or CANCELLED — reject with a clear error code if so; this needs an INVALID_STATE_TRANSITION-style error per the Engineering Spec's standard error code list).
Reject any attempt to change talk_id if the event has at least one notification with status != 'pending' (i.e. something has already been dispatched) — return a clear "immutable field" error.
On any successful update: increment events.version.
If start_datetime or end_datetime changed: recalculate scheduled_at for all notification_schedules rows tied to this event where status IN ('pending','retrying'), preserving each schedule's original offset from the event time (e.g. a pre-event reminder originally set for "24h before start" should be recalculated as "24h before the new start", not left at its old absolute timestamp).
Trigger a change notification: insert a new notification row (or reuse the existing "event update" trigger_type if the Engineering Spec defines one — check notification_schedules.trigger_type enum; if event_update isn't a defined value yet, this migration should add it) addressed to all expected members, with payload describing what changed.


src/features/events/service.ts: add updateEvent() implementing the above; keep it pure/testable, separate from the route handler's auth/validation wrapper.

Phase 3 — Test checklist
8. documentation/test-plans/FP-14-event-update-checklist.md:

Update non-immutable field → version increments, notification triggered, expected members receive it
Attempt to change talk_id after a notification has dispatched → rejected
Attempt to change talk_id before any notification has dispatched → allowed
Reschedule start_datetime → unsent notification scheduled_at values recalculated correctly (preserve relative offset)
Already-sent notifications are untouched by a reschedule (only pending/retrying rows recalculated)
Update attempt on a LOCKED or CANCELLED event → rejected with appropriate error
Non-Admin attempting update → FORBIDDEN_ROLE
Cross-tenant update attempt → CROSS_TENANT_ACCESS

Files to Create/Modify

supabase/migrations/20260629000004_event_update_versioning.sql (new)
app/api/events/[id]/route.ts (new or modified — check for existing PATCH handler from FP-12 first)
src/features/events/service.ts (modified — add updateEvent)
documentation/dips/DIP-FP-14.md (new, verbatim)
documentation/test-plans/FP-14-event-update-checklist.md (new)

Migration Files
supabase/migrations/20260629000004_event_update_versioning.sql — per step 4. Local-only validation. Never run against remote/production directly.
Branch Name
feature/FP-14-event-update-notifications
Commit Message
FP-14: implement event update with version tracking, immutable talk_id post-notification, and unsent notification reschedule recalculation
Pull Request Description

Updates increment events.version ✓
Event update triggers notification to expected members with changed details ✓
talk_id treated as the immutable-post-notification field (interpretive choice — see Grounding Check; no other field is named explicitly immutable in the spec, and talk_id is the only one whose post-notification mutation would corrupt formation credit under Section 4 Rule 4)
Reschedule of timing recalculates unsent notification schedules, preserving relative offset, leaving already-sent notifications untouched ✓

Jira Linkage

PDEEpicID: FP-11 (EPIC-3 — Event Lifecycle Management), verified live via Jira parent field this session
PDEStoryID: FP-14 (STORY-3.3)

Stop Point
Open the PR against dev and stop. Do not merge — the user will check out the branch locally, test it, and merge manually.

Implementation Notes (executor observations, not part of original DIP)
- DIP references "notification_schedules" and "scheduled_at" — the actual table created in migration 000002 is "event_notifications" with column "scheduled_for". All implementation uses the actual schema names.
- events.version was not present in migration 000002 — added via ALTER TABLE in this migration.
- events.talk_id was not present in any prior migration — added via ALTER TABLE in this migration. Without this column the immutability enforcement in Phase 2 would have no data to gate on.
- event_notifications.status CHECK in migration 000002 only included ('PENDING','SENT','FAILED'); RETRYING added in this migration.
- event_notifications.purpose CHECK in migration 000002 only included the three original purposes; EVENT_UPDATE added in this migration to support the change notification row.
- No DIP-STORY-3.3.md found in documentation/dips/ — clean slate confirmed.
