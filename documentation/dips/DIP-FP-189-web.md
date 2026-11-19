DIP-FP-189-web

Story Summary
Adds guest headcount to RSVP: a new "Guests Allowed" toggle at the event level (default off, no effect on any existing event), a guest_count on Yes/Tentative RSVPs only (never No, enforced at the database layer), a tenant-configurable maximum (default 10), and guest totals surfaced alongside the existing member counts in the web RSVP report.

Repo Target
Web (Next.js), owgc-tech/flockpulse-web.

Grounding Check
- upsert_rsvp_with_audit confirmed to have exactly one definition in the entire migration history (20260629000017_audit_logs.sql) — never redefined since, so this is genuinely the current live signature, not something that needs the same "find the last, not the first" caution FP-191's insert_event_with_audit needed.
- rsvps table confirmed live: rsvp_status CHECK ('YES','NO') at the base migration, later widened to include 'TENTATIVE' (20260718000046, confirmed earlier this engagement). rsvps_reason_required_check is the existing precedent for a Yes/No-conditional column constraint — guest_count's own constraint mirrors this exact shape (No must never carry it; Yes/Tentative may).
- tenants.rsvp_closure_days_default (20260717000044) is the exact precedent for max_guest_count_default: ADD COLUMN with a DEFAULT, paired with an idempotent DO-block CHECK constraint. Mirrored exactly, not reinvented.
- events.guests_allowed needs adding to both insert_event_with_audit (currently 15 params, confirmed via the same "find every redefining migration, take the last one" method used for FP-191) and update_event_with_audit (patch-based, single JSONB parameter) — the patch-based RPC's exact internal field-application mechanism should be verified directly against the live function body before implementing, not assumed from this DIP's description alone.
- getRsvpReportSummary (report.repository.ts) already computes per-status member counts server-side via the roster-driven join pattern established for exactly this kind of "don't trust raw table totals" correctness — guest totals are added as a separate, clearly distinct additional field, never blended into the existing member counts.

Implementation Plan
1. Migration:
   - tenants.max_guest_count_default INTEGER NOT NULL DEFAULT 10, CHECK (max_guest_count_default > 0), mirroring rsvp_closure_days_default's exact idempotent pattern.
   - events.guests_allowed BOOLEAN NOT NULL DEFAULT false.
   - rsvps.guest_count INTEGER, CHECK (guest_count IS NULL OR (rsvp_status IN ('YES','TENTATIVE') AND guest_count >= 0)) — mirrors rsvps_reason_required_check's shape, enforced at the database layer, not just the API.
   - A second CHECK (or a trigger, if a plain CHECK can't reach the tenant's configurable max) enforcing guest_count <= the owning tenant's max_guest_count_default. Confirm at implementation time whether a CHECK constraint can reference another table's value directly (typically it cannot in plain Postgres) — if not, this needs a BEFORE INSERT OR UPDATE trigger instead, following the same enforcement-at-the-database-layer principle either way.
   - DROP FUNCTION IF EXISTS on upsert_rsvp_with_audit's current 6-arg signature, recreate with a new p_guest_count INTEGER parameter (nullable) added before p_actor_member_id.
   - Extend insert_event_with_audit (DROP + CREATE OR REPLACE, current signature confirmed 15 params) with p_guests_allowed BOOLEAN. Extend update_event_with_audit's patch handling to accept a guests_allowed key.
2. Repository/service: extend the RSVP submission service call to pass guest_count. Extend getRsvpReportSummary's response with a total_guests field (sum of guest_count across all Yes/Tentative rows in the current result set) — computed alongside the existing per-status counts, not a separate query.
3. Web admin UI: EventForm.tsx gains a "Guests Allowed" toggle, defaulting to the event's current value (false for new events).

Files to Create/Modify
- supabase/migrations/[next]_rsvp_guest_count.sql (new)
- src/features/rsvps/rsvp.repository.ts (modify — upsert_rsvp_with_audit caller)
- src/features/events/service.ts (modify — insert/update event callers pass guests_allowed)
- src/features/reports/report.repository.ts (modify — getRsvpReportSummary's total_guests)
- app/admin/(shell)/events/EventForm.tsx (modify — new toggle)

Migration Files
Full SQL at implementation time per the Implementation Plan above.

Branch Name
feature/FP-189-web-rsvp-guest-count

Commit Message
FP-189-web: add guest headcount to RSVP — Guests Allowed toggle, tenant-configurable max, report totals

Pull Request Description
- Confirm a No RSVP genuinely cannot carry a guest_count (attempt one directly via API, confirm it's rejected).
- Confirm the tenant max is actually enforced at the database layer, not just checked client-side (attempt to exceed it directly via API).
- Confirm total_guests in the RSVP report is a clearly separate field from the existing member counts, never summed into them.
- Confirm which enforcement mechanism (CHECK vs. trigger) was actually needed for the tenant-max check, and why.

Jira Linkage
- PDEEpicID: FP-15
- PDEStoryID: FP-189

Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-189-web.md. Branch off current dev. Open a PR against dev and stop. Do not merge.

Include full diffs for every file in the completion report, no elisions.
