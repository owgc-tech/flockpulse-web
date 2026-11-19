DIP-FP-134-web
Story Summary
Web half of FP-134 (RSVP nudge notifications). Admins configure three fixed, tenant-wide day-offsets (defaults 7/5/3 days before RSVP closure) on the Community Settings page — the same screen and pattern FP-125/FP-133 already established for rsvp_closure_days_default. This DIP also completes a gap left by FP-133-web: mobile needs to know when RSVP actually closes for a given event to drive FP-133-mobile's editability and FP-134-mobile's nudge scheduling, but today only the raw ingredients (start_datetime, rsvp_closure_days, rsvp_closure_days_default) are exposed separately — the actual cutoff arithmetic lives inline in rsvp.service.ts's write guard and nowhere else. This DIP extracts that arithmetic into one shared helper and exposes its result as rsvp_closure_at on both event read endpoints, so mobile never re-derives the calculation client-side.
Repo Target
Web (Next.js) — owgc-tech/flockpulse-web. Pure admin-config + API surface; no mobile UI in this DIP.
Grounding Check

Confirmed live: tenants.rsvp_closure_days_default and events.rsvp_closure_days (migration 20260717000044_community_settings_and_rsvp_closure.sql) — the three new columns this DIP adds follow the identical shape (scalar INTEGER, IF NOT EXISTS, named DO $$ pg_constraint $$ guard, 0–90 range) rather than an array column, matching the established idiom.
Confirmed live: insert_event_with_audit/update_event_with_audit are not touched by this DIP — no event-table field is being added, only tenant-table fields and a derived (non-persisted) response field. No DROP+CREATE OR REPLACE needed here.
Confirmed live: rsvp.service.ts's submitRsvp already computes the exact cutoff inline (start_datetime − COALESCE(event override, tenant default) days) for its RSVP_CLOSED guard — canonical error code, correctly reused, not touched by this DIP. This DIP extracts that same formula into a pure helper both the guard and the new read-path call, so there is exactly one implementation of "when does RSVP close," not two.
Confirmed live: listEventsForMember (GET /api/events/mine) and getEventById (GET /api/events/:id) both already select rsvp_closure_days and spread it into their response — rsvp_closure_at is additive, no existing field removed or renamed.
Confirmed live: getTenantSettings/updateTenantSettings in src/features/tenant/service.ts and the PATCH /api/tenant/settings route both explicitly destructure named fields (standing checklist item) — updated accordingly.
No conflict with Section 4 invariants: this is tenant-scoped configuration and a derived read-only field, not attendance/RSVP lifecycle logic.

Implementation Plan

Migration (see below) — add rsvp_nudge_days_1/2/3 to tenants, defaults 7/5/3, each CHECK 0–90, IF NOT EXISTS + named constraint guards.
src/features/rsvps/rsvp-window.ts (new file) — pure helper:

ts   export function computeRsvpClosureAt(
     startDatetime: string,
     eventOverrideDays: number | null,
     tenantDefaultDays: number
   ): string {
     const closureDays = eventOverrideDays ?? tenantDefaultDays;
     const cutoffMs = new Date(startDatetime).getTime() - closureDays * 24 * 60 * 60 * 1000;
     return new Date(cutoffMs).toISOString();
   }

src/features/rsvps/rsvp.service.ts — replace the inline cutoff calculation in submitRsvp with a call to computeRsvpClosureAt(closureInfo.start_datetime, closureInfo.rsvp_closure_days, tenantDefaultDays), then compare Date.now() >= new Date(closureAt).getTime(). No behavior change — this is a refactor, not a logic change. Verify with a manual trace before considering this step done: same inputs must produce the same RSVP_CLOSED outcome as today.
src/features/events/service.ts:

listEventsForMember: after fetching upcoming, fetch getTenantRsvpClosureDaysDefault(tenantId) once (already exported from rsvp.repository.ts — import it, don't duplicate the query), then map each event to include rsvp_closure_at: computeRsvpClosureAt(e.start_datetime, e.rsvp_closure_days, tenantDefaultDays).
getEventById: same pattern, single tenant-default fetch + one computeRsvpClosureAt call, added to the returned object.


src/features/events/event.types.ts — add rsvp_closure_at: string; to EventListRow (inherited by EventDetailRow), with a comment noting it's server-computed, not a persisted column.
src/features/tenant/service.ts:

getTenantSettings: add rsvp_nudge_days_1, rsvp_nudge_days_2, rsvp_nudge_days_3 to the select list and returned type.
updateTenantSettings: accept optional rsvpNudgeDays1/2/3 in input, validate each as an integer 0–90 (reuse the INVALID_VALUE code, same message shape as rsvpClosureDaysDefault's validation), patch rsvp_nudge_days_1/2/3.


app/api/tenant/settings/route.ts (PATCH) — destructure rsvpNudgeDays1, rsvpNudgeDays2, rsvpNudgeDays3 from body alongside the existing fields, pass through to updateTenantSettings.
app/admin/(shell)/community/actions.ts — extend updateCommunityRsvpSettingsAction to also read rsvpNudgeDays1/2/3 from the FormData and pass them to updateTenantSettings. (Kept in the same action/form-submit as the closure-days field, not a new save button — same screen, same save gesture, per FP-134's "coordinate, don't build the fields twice" note.)
app/admin/(shell)/community/CommunitySettingsForm.tsx — add three number inputs to the existing "RSVP & Attendance" card, below the closure-default field: "RSVP nudge reminders (days before closure)" with three labeled sub-fields (1st, 2nd, 3rd nudge), each min={0} max={90}, wired into the same handleRsvpSettingsSave submit. Read-only view (non-canEdit branch) lists the three values.
app/admin/(shell)/community/page.tsx — pass initialRsvpNudgeDays1/2/3 props from settings.rsvp_nudge_days_1/2/3.

Files to Create/Modify

supabase/migrations/20260717000045_rsvp_nudge_settings.sql (new)
src/features/rsvps/rsvp-window.ts (new)
src/features/rsvps/rsvp.service.ts (modify — refactor cutoff calc to use shared helper)
src/features/events/service.ts (modify — listEventsForMember, getEventById)
src/features/events/event.types.ts (modify — add rsvp_closure_at)
src/features/tenant/service.ts (modify — getTenantSettings, updateTenantSettings)
app/api/tenant/settings/route.ts (modify — PATCH body destructuring)
app/admin/(shell)/community/actions.ts (modify — updateCommunityRsvpSettingsAction)
app/admin/(shell)/community/CommunitySettingsForm.tsx (modify — 3 new inputs)
app/admin/(shell)/community/page.tsx (modify — 3 new props)

Migration Files
sql-- FP-134: tenant-wide RSVP nudge day-offsets (web half — Community Settings config).
-- Mobile half (DIP-FP-132-FP-133-FP-134-mobile) consumes these via GET /api/tenant/settings.

ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS rsvp_nudge_days_1 INTEGER NOT NULL DEFAULT 7,
    ADD COLUMN IF NOT EXISTS rsvp_nudge_days_2 INTEGER NOT NULL DEFAULT 5,
    ADD COLUMN IF NOT EXISTS rsvp_nudge_days_3 INTEGER NOT NULL DEFAULT 3;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_rsvp_nudge_days_1_check'
  ) THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_rsvp_nudge_days_1_check
      CHECK (rsvp_nudge_days_1 >= 0 AND rsvp_nudge_days_1 <= 90);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_rsvp_nudge_days_2_check'
  ) THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_rsvp_nudge_days_2_check
      CHECK (rsvp_nudge_days_2 >= 0 AND rsvp_nudge_days_2 <= 90);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_rsvp_nudge_days_3_check'
  ) THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_rsvp_nudge_days_3_check
      CHECK (rsvp_nudge_days_3 >= 0 AND rsvp_nudge_days_3 <= 90);
  END IF;
END $$;
Verify the actual next migration number against the live supabase/migrations/ directory before naming the file — confirmed 20260717000044 is the current latest as of this DIP's drafting, but do not trust that placeholder; check live per standing rule.
Branch Name
feature/FP-134-web-rsvp-nudge-settings
Commit Message
FP-134: add tenant RSVP nudge day-offset settings + expose rsvp_closure_at on event endpoints
Pull Request Description
Maps to FP-134's web-facing AC: "Admin configures three nudge day-offsets on Community Settings (each ≥ 0 days before closure)" — three validated, persisted, editable fields on the existing RSVP & Attendance card. Also unblocks FP-133-mobile and FP-134-mobile by exposing a single server-computed rsvp_closure_at per event, removing the need for either client to re-implement the closure-cutoff formula.
Jira Linkage

PDEEpicID: FP-15 (EPIC-4 — RSVP Management)
PDEStoryID: FP-134

Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-134-web.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against dev and stop. Do not merge. Joseph will check out the branch locally, test it, and merge manually. Testing happens only after merge, against the deployed dev-branch Vercel environment — there is no local Docker/Supabase checkout workflow for this project. Do not suggest testing before merging.
Include full diffs for every file in your completion report — not a summary.
