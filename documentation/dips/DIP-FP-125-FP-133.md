DIP-FP-125-FP-133
Story Summary
One web DIP covering the Community Settings build-out and the web half of the RSVP closure window. FP-125: make the community name editable (backend + UI) and surface the existing attendance-window setting on the Community Settings page. FP-133 (web half): tenant-level "RSVP closes N days before event start" default (0 = today's behavior) + per-event nullable override on the web event forms + server-side enforcement of the computed cutoff. Bundled per Section 5.9: both stories edit the same settings screen, the same updateTenantSettings() service, and the same /api/tenant/settings route.
Not covered — deliberately excluded: FP-133's mobile half (mobile event-form override field, RsvpControls cutoff, FP-132 label condition) — follow-on mobile DIP; safe because the tenant default ships as 0, changing nothing until an Admin sets a value. FP-134's nudge-day fields — belong to the nudge feature, no dead config fields. FP-125's rating-mode field — deferred to Day-2 by product decision. FP-110 — re-scoped to per-member mobile, no longer part of this surface. FP-125's doc-review AC — completed 2026-07-17 via the documentation sweep (no additional spec'd tenant settings found); this DIP implements the resulting inventory.
Repo Target
Web (Next.js) — owgc-tech/flockpulse-web, branch off dev.
Grounding Check

Verified live: updateTenantSettings() (src/features/tenant/service.ts) accepts {attendanceWindowHours, tagline, description} with attendance-window validation 1–720 already enforced; getTenantSettings() already returns name and attendance_window_hours. Adding name (write) and rsvpClosureDaysDefault extends the established pattern.
Verified live: the RSVP guard (src/features/rsvps/rsvp.service.ts) throws canonical RSVP_CLOSED when effectiveStatus !== 'SCHEDULED' — the closure check extends this same guard and reuses this same code. No new error codes.
Verified live: Community Settings UI lives under app/admin/(shell)/community; the settings route is app/api/tenant/settings/route.ts. Verify at execution: whether the route's PATCH destructuring currently includes tagline/description or only attendanceWindowHours — either way, add name and rsvpClosureDaysDefault per the standing route-destructuring checklist.
Verify at execution: web event create/edit form locations under app/admin/(shell) (not inspected); the event create/update service is src/features/events/service.ts with explicit patch-building — the new field follows its existing optional-field pattern.
Migration numbering: determine the next number from the actual latest file in dev at execution time (expected ≥ 000044 after FP-121's 000043) — do not trust this DIP's placeholder. This is a repeat of a real numbering incident; check first.
Invariants untouched (RSVP remains pre-event intent; closure is an independent cutoff, not a lifecycle state — the derived-status machinery is not modified). New columns are additive with defaults; no cross-tenant trigger needed (no new FKs). Prior work: no DIP-FP-125 or DIP-FP-133 exists.

Implementation Plan

Phase 0 (strict order): branch off dev → live-verify the grounding items above → save this DIP verbatim → code.
Migration (filename per grounding note, slug community_settings_and_rsvp_closure):

tenants.rsvp_closure_days_default INTEGER NOT NULL DEFAULT 0 + CHECK 0–90 (idempotency-guarded per house pattern)
events.rsvp_closure_days INTEGER NULL + CHECK 0–90 when non-null (idempotency-guarded)


Tenant service/route: updateTenantSettings() accepts name (trimmed, non-empty, ≤150 chars, VALIDATION_ERROR on violation) and rsvpClosureDaysDefault (integer 0–90, INVALID_VALUE on violation, mirroring the attendance-window pattern); include both in the returned select. Route PATCH destructures and forwards both.
Community Settings UI (app/admin/(shell)/community): editable name field; attendance-window number field (1–720, labeled "Hours after an event ends before attendance locks"); RSVP closure default field (0–90, labeled "RSVP closes this many days before an event starts — 0 = at event start"). Follow the page's existing form/save conventions.
Event service + forms: createEvent/updateEvent accept optional rsvpClosureDays (nullable, 0–90); route handlers destructure it (standing checklist); web event create/edit forms get an optional "RSVP closes (days before start)" field with empty = tenant default; event GET/list selects include the column (mobile consumes it later).
RSVP guard extension in rsvp.service.ts, after the existing SCHEDULED check: fetch the event's start_datetime + rsvp_closure_days and the tenant's rsvp_closure_days_default; compute cutoff = start − COALESCE(override, default) days; if now ≥ cutoff, throw the existing RSVP_CLOSED. With default 0 and no override, cutoff = start and the check is a no-op past the SCHEDULED gate — today's behavior byte-identical.
Validation: migration applied to the local Docker stack only; functional smoke test of the guard with a synthetic event (closure 3 days out → RSVP rejected with RSVP_CLOSED; closure 0 → accepted while SCHEDULED); npm run build passes.

Files to Create/Modify
supabase/migrations/[NEXT]_community_settings_and_rsvp_closure.sql   (new)
src/features/tenant/service.ts
app/api/tenant/settings/route.ts
app/admin/(shell)/community/[settings page component(s) — per verification]
src/features/events/service.ts
app/api/events/route.ts  (+ the event [id] route if update is separate — verify)
[web event create/edit form component(s) — per verification]
src/features/rsvps/rsvp.service.ts  (+ repository if a fetch helper is needed)
documentation/dips/DIP-FP-125-FP-133.md  (new)
Migration Files
sql-- FP-125 / FP-133: RSVP closure window (tenant default + per-event override).
-- Community name editability needs no schema change (tenants.name exists).

ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS rsvp_closure_days_default INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_rsvp_closure_days_default_check'
  ) THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_rsvp_closure_days_default_check
      CHECK (rsvp_closure_days_default >= 0 AND rsvp_closure_days_default <= 90);
  END IF;
END $$;

ALTER TABLE events
    ADD COLUMN IF NOT EXISTS rsvp_closure_days INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_rsvp_closure_days_check'
  ) THEN
    ALTER TABLE events
      ADD CONSTRAINT events_rsvp_closure_days_check
      CHECK (rsvp_closure_days IS NULL OR (rsvp_closure_days >= 0 AND rsvp_closure_days <= 90));
  END IF;
END $$;
Branch Name
feature/FP-125-FP-133-community-settings-rsvp-closure
Commit Message
FP-125 FP-133: editable community name, attendance window UI, RSVP closure window (tenant default + event override + guard)
Pull Request Description

FP-125 AC1 (name editable): service + route + UI, Admin-only via existing route protection.
FP-125 AC2 (attendance window surfaced): UI field over the existing 1–720 backend.
FP-125 AC3 (doc review): completed 2026-07-17 outside this PR; inventory implemented here.
FP-133 web ACs: tenant default field (0–90, default 0); per-event override on web forms; guard rejects with canonical RSVP_CLOSED past start − COALESCE(override, default); default-0 behavior byte-identical to today (explicitly verified in smoke test).
Explicitly deferred: FP-133 mobile half (follow-on DIP), FP-134 fields, rating mode (Day-2).

Jira Linkage

PDEEpicID: FP-5 (FP-125), FP-15 (FP-133)
PDEStoryID: FP-125, FP-133

Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-125-FP-133.md; never append to it — observations go in the PR description only. Migration validated locally via Docker Supabase only, never remote. npm run build must pass before pushing. Open the PR against dev and stop — do not merge. Full unelided diffs in the completion report per rule 12.
