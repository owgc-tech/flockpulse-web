DIP-FP-13
Story Summary
Implements automatic, time-based transitions through an event's lifecycle (SCHEDULED → ACTIVE → COMPLETED → LOCKED), driven by a pg_cron job rather than any manual action. The COMPLETED→LOCKED transition is gated by a tenant-configurable attendance window (default 24 hours), measured from event.end_datetime — confirmed with the user, resolving PIB Open Question OQ-1. Cancelled events suppress pending notifications and are blocked from further state-dependent actions.
Repo Target
Web — owgc-tech/flockpulse-web, dev branch convention. The cron job and its underlying function live in the shared Supabase backend (Section 3), but this story is being delivered through the web repo's migration pipeline since that's the only repo with an established Supabase Local CLI workflow; there's no mobile-specific work here.
Grounding Check
Cross-checked against live Jira (FP-13, parent FP-11/EPIC-3) and Epics & Stories v3 JSON — verbatim match. This resolves PIB OQ-1, previously listed as unresolved in every canonical artifact (PIB Section 14, PDD Section 10). The resolution, confirmed directly with the user this session:

Attendance window is tenant-wide and configurable (not a single system-wide constant, not per-event, not per-user — a tenant is the whole community: many leaders, many members, one shared setting).
Default value: 24 hours.
Anchor point: event.end_datetime — confirmed explicitly after I flagged the ambiguity in the user's original phrasing ("24 hours from the time the event started"), since anchoring to start_datetime would mathematically allow LOCKED to occur before COMPLETED for any event longer than the window itself.

Two flags, neither blocking but both real:

AC bullet "blocks RSVP, self-report, and confirmation actions" is only partially implementable right now. None of RSVP (EPIC-4), self-report (EPIC-5), or leader confirmation (EPIC-6) have been built yet — only EPIC-1/2/3(partial) exist in the codebase as of this session. This DIP implements the cancellation-blocking guard generically (a reusable "is this event open for member-facing actions?" check that any future RSVP/self-report/confirmation endpoint must call), and proves it against the one thing that does exist today (event update, FP-14, if merged — or just the event read/list path otherwise). It does not and cannot prove RSVP/self-report/confirmation are blocked, because those endpoints don't exist. Flagging this in the PR rather than claiming the bullet as fully satisfied — same discipline as FP-7's partial-satisfaction note.
Migration numbering must not be hardcoded. FP-14 (DIP already issued, not necessarily merged) claims ...000004. This DIP's migration must be numbered by checking the actual latest file in dev at execution time, not assumed as ...000005 — see step 4.

No conflicts with Section 4 invariants — this story is purely event-lifecycle, doesn't touch attendance/RSVP/formation data directly (only gates access to those future features).
Implementation Plan
Phase 0

Branch feature/FP-13-event-state-transitions off dev.
Check documentation/dips/ for any prior DIP file (DIP-STORY-3.3.md or similar) from the earlier Gemini workflow — none expected per the remediation's prior-DIP inventory, but verify.
Before naming the migration file, run ls supabase/migrations/ and identify the actual highest-numbered file currently in dev (accounting for FP-14 having possibly merged already). Name this migration the next sequential number after that — do not assume ...000005.
Persist this DIP verbatim to documentation/dips/DIP-FP-13.md.

Phase 1 — Schema
5. Write the migration (numbered per step 3):

Add tenants.attendance_window_hours INTEGER NOT NULL DEFAULT 24 (tenant-configurable, per OQ-1 resolution).
Enable the pg_cron extension (CREATE EXTENSION IF NOT EXISTS pg_cron;) — confirm it's available in the local Supabase Docker stack before assuming; if it's not enabled by default locally, this migration must enable it, and note in the PR if any local Supabase config change (e.g. config.toml) was also required.
Write transition_event_states() as a SECURITY DEFINER function with SET search_path = public, pg_catalog explicitly stated (this exact omission was the root cause of a security advisory caught and fixed during the remediation pass — do not repeat it here). Logic:

UPDATE events SET status = 'ACTIVE' WHERE status = 'SCHEDULED' AND start_datetime <= now()
UPDATE events SET status = 'COMPLETED' WHERE status = 'ACTIVE' AND end_datetime <= now()
UPDATE events SET status = 'LOCKED' WHERE status = 'COMPLETED' AND end_datetime + (SELECT attendance_window_hours FROM tenants WHERE tenants.id = events.tenant_id) * INTERVAL '1 hour' <= now()
Run all three in this exact order, within the same function call, so an event can theoretically cascade through multiple transitions in one pass if the cron interval was missed (e.g. system was down) rather than getting stuck.


Schedule the job: SELECT cron.schedule('transition-event-states', '*/5 * * * *', 'SELECT transition_event_states();'); — every 5 minutes; document this interval choice in the PR as a reasonable default, not a requirement from any spec (cron frequency isn't specified anywhere in the PDD/Engineering Spec).
Write block_actions_on_cancelled_or_locked(p_event_id UUID) RETURNS BOOLEAN (or equivalent) as the reusable guard mentioned in the Grounding Check — returns true if the event's current status is CANCELLED or LOCKED (i.e. action should be blocked). Future RSVP/self-report/confirmation endpoints are expected to call this; document that expectation in a code comment since this DIP can't build those endpoints itself.
Add a trigger or inline logic so that when an event's status transitions to CANCELLED (via the existing cancel action from FP-12/earlier work — verify it exists; if not, this is itself a gap to flag) all notification_schedules rows for that event with status IN ('pending','retrying') are updated to status = 'cancelled'.


supabase db reset to validate the full chain including the new extension and scheduled job.
Manually verify locally: insert a test event with start_datetime/end_datetime in the past, manually invoke SELECT transition_event_states(); (don't wait 5 minutes), confirm status cascades correctly; verify the LOCKED transition respects a non-default attendance_window_hours value set on a test tenant.

Phase 2 — Application layer
8. Expose tenant attendance-window configuration: extend whatever tenant-settings surface exists (check if one was built — if not, a minimal PATCH /api/tenant/settings accepting attendance_window_hours is in scope here, Admin-only, since the AC requires it be configurable and there'd be no way to configure it otherwise).
9. No new event-facing routes are strictly required for the transitions themselves (they happen via cron, not API calls) — but the event read/list endpoints should expose status as-is (now always correct, since it's actually written by the cron job, not computed lazily) with no additional service-layer change needed beyond what FP-12 already built.
Phase 3 — Test checklist
10. documentation/test-plans/FP-13-event-state-transitions-checklist.md:
- SCHEDULED event past its start_datetime → cron invocation transitions it to ACTIVE
- ACTIVE event past its end_datetime → transitions to COMPLETED
- COMPLETED event past end_datetime + tenant.attendance_window_hours → transitions to LOCKED
- Non-default attendance_window_hours (e.g. set to 6 on a test tenant) → LOCKED transition respects the custom value, not the 24h default
- Event significantly overdue (e.g. simulating a missed cron run) → cascades through multiple transitions correctly in one pass
- Cancelled event → all pending/retrying notification schedule rows flipped to cancelled
- block_actions_on_cancelled_or_locked() returns true for CANCELLED and LOCKED events, false otherwise — note in the checklist that this can only be unit-tested against the function directly, since no RSVP/self-report/confirmation endpoint exists yet to integration-test the actual blocking behavior end-to-end
- pg_cron job is actually registered (SELECT * FROM cron.job;) and running on the expected schedule
Files to Create/Modify

supabase/migrations/[NEXT_SEQUENTIAL]_event_state_transitions.sql (new — filename determined at execution time per step 3)
app/api/tenant/settings/route.ts (new, if no tenant-settings endpoint already exists — verify first)
src/features/tenant/service.ts (new or modified)
documentation/dips/DIP-FP-13.md (new, verbatim)
documentation/test-plans/FP-13-event-state-transitions-checklist.md (new)

Migration Files
Filename TBD per step 3 (do not hardcode). Content per Implementation Plan step 5. Local-only validation via supabase db reset. Never run against remote/production directly — and note for the reviewer: pg_cron scheduling itself is a write that happens during migration apply, so confirm the remote Supabase project's pg_cron extension availability before this migration is ever proposed for production (some hosting tiers restrict it) — this is a manual pre-check for the user, not something CC can verify against remote.
Branch Name
feature/FP-13-event-state-transitions
Commit Message
FP-13: implement pg_cron-driven event state transitions with tenant-configurable attendance window (resolves OQ-1)
Pull Request Description

SCHEDULED→ACTIVE at start_datetime ✓ (cron-driven)
ACTIVE→COMPLETED at end_datetime ✓ (cron-driven)
COMPLETED→LOCKED after attendance window closes ✓ — window is tenant-configurable (attendance_window_hours, default 24), anchored at event.end_datetime, resolving PIB OQ-1 per direct user confirmation this session
Cancelled events suppress pending notifications ✓ (notification_schedules rows flipped to cancelled)
Cancelled events block RSVP/self-report/confirmation actions — partially satisfied. A reusable block_actions_on_cancelled_or_locked() guard is implemented and unit-testable, intended for future RSVP (EPIC-4), self-report (EPIC-5), and confirmation (EPIC-6) endpoints to call. None of those endpoints exist yet, so end-to-end blocking cannot be proven in this PR — do not mark this AC bullet as fully done.

Note to reviewer: confirm pg_cron is available on the remote/production Supabase tier before this migration is ever applied there.
Jira Linkage

PDEEpicID: FP-11 (EPIC-3 — Event Lifecycle Management), verified live via Jira parent field this session
PDEStoryID: FP-13 (STORY-3.2)

Stop Point
Open the PR against dev and stop. Do not merge — the user will check out the branch locally, test it, and merge manually.

Implementation Notes (executor observations, not part of original DIP)
- Migration is numbered 000005 (confirmed at execution time: highest file on dev was 000004 after FP-14 merged).
- pg_cron v1.6.4 confirmed available in local Supabase Docker stack; not yet installed. CREATE EXTENSION in the migration is sufficient — no config.toml change required.
- No existing event cancellation endpoint found in any migration or app layer. This is a gap: the trigger that suppresses notifications on CANCELLED status has no API-level caller. Flagged in PR description.
- 'CANCELLED' was not a valid event_notifications.status value — added to the CHECK constraint in this migration alongside the trigger.
- No prior DIP-FP-13.md or DIP-STORY-3.2.md found in documentation/dips/ — clean slate confirmed.
- No tenant-settings API surface existed — PATCH /api/tenant/settings created in this DIP.
