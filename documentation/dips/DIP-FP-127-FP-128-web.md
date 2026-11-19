DIP-FP-127-FP-128-web.md
Story Summary
FP-127 adds a third RSVP intent value, TENTATIVE, alongside the existing YES/NO — matching how calendar tools typically work. FP-128 is its companion reporting story: extending the existing FP-37 RSVP report (/admin/reports/rsvp) to show per-event response counts (Yes/No/Tentative/No response) that reconcile to the event's expected-attendee total. These are combined into one web-repo DIP because FP-128's counts are only meaningful once TENTATIVE exists as a real value flowing through the same rsvps table and event_attendees roster join FP-128 extends — implementing them separately would mean touching the same report-repository lines twice. This DIP covers every web-repo surface: the DB constraint, the RSVP submission API, the roster-derivation service consumed by both web admin and mobile, and the report aggregation. The mobile-side UI for submitting a Tentative RSVP is covered in a companion DIP (DIP-FP-127-mobile.md) since flockpulse-mobile is a separate repo.
Repo Target
Web (Next.js) — owgc-tech/flockpulse-web. This DIP owns all schema, API, and service-layer changes (mobile has no backend of its own), plus the two web-admin surfaces that render RSVP responses (EventDetail roster, RSVP report).
Grounding Check
Confirmed live against dev branch (tarball pull, not GitHub API — rate-limited as expected):

rsvps.rsvp_status constraint (20260629000007_rsvps.sql): inline, unnamed CHECK (rsvp_status IN ('YES', 'NO')). Per the FP-113 precedent (20260715000038_expand_role_model.sql, which widened members.role/invitations.role the same way), the constraint name is not hardcoded — this DIP looks it up dynamically via pg_constraint/pg_attribute before dropping it, exactly matching that migration's pattern, since guessing rsvps_rsvp_status_check wrong and leaving a duplicate narrower constraint active would be a worse failure than the extra lines.
rsvp_reason requirement (rsvp.service.ts submitRsvp): only triggers on rsvpStatus === 'NO'. TENTATIVE naturally requires no reason with zero code changes there — confirmed, not assumed.
Roster derivation (service.ts getEventRoster, lines ~753–769): ternary !rsvp ? 'NOT_RESPONDED' : rsvp.rsvp_status === 'YES' ? 'ACCEPTED' : 'DECLINED' — currently maps anything that isn't YES to DECLINED, which would silently misclassify TENTATIVE as Declined if left untouched. Must become a proper 3-way branch. Response type is RosterEntry['response'], currently 'ACCEPTED' | 'DECLINED' | 'NOT_RESPONDED' — needs a fourth value. Using 'TENTATIVE' directly (not inventing a synonym) to stay consistent with the DB value and FP-127's mobile-side RosterResponseValue.
RSVP report (report.repository.ts getRsvpReport): builds detail rows per (event, member), not aggregate counts — rsvp_status: 'YES' | 'NO' | 'NO_RESPONSE', defaulting via ?? 'NO_RESPONSE'. FP-128 asks for per-event aggregate counts. Per Joseph's story text ("extend the existing report UI... in place if feasible"), this DIP adds a new aggregate function (getRsvpReportSummary) alongside the existing detail-row function rather than replacing it — the detail view stays useful for drilling into a specific event/member, and the new summary view is what FP-128's acceptance criteria actually describe. Both share the same event_attendees ⋈ rsvps join pattern already established.
Notifications (reminders.service.ts, rsvpNudgeReminders.service.ts — mobile repo, checked for completeness since the story asked): reminders skip only rsvp_status === 'NO'; nudges skip on any non-null status. Neither excludes specifically on 'YES' or 'NO', so TENTATIVE falls through to "still gets reminded, stops getting nudged" — identical to YES's behavior today. Confirmed correct, no code change needed — this is the same behavior a YES RSVP gets, and Tentative implies "might still attend," so continuing reminders and stopping nudges is the right default. Flagging this explicitly per the story's ask rather than silently skipping it.
Canonical error codes: no new error codes needed. rsvp_status !== 'YES' && rsvp_status !== 'NO' in the API route becomes a 3-way check; the existing INVALID_VALUE code (already used elsewhere in this codebase, e.g. app/api/invitations/route.ts) covers an invalid value, so this DIP reuses it rather than inventing one.
Cross-tenant safety: no new tables, no new FKs — not applicable to this DIP.
Atomicity: no new multi-table writes — not applicable.
Domain rules (Section 4): no conflict. RSVP remains pre-event intent only; nothing here touches self-report, confirmation, or attendance/formation credit. TENTATIVE is intent, not attendance.
Aside, not in scope: app/api/rsvps/route.ts still throws NOT_AN_ATTENDEE/INVALID_STATE (the exact pre-existing naming the canonical-error-code rule was written to prevent recurring). This DIP does not touch those — renaming them isn't part of FP-127/128's scope and would be undocumented scope creep. Worth a future tech-debt ticket if Joseph wants it cleaned up.

Implementation Plan

Migration: widen rsvps.rsvp_status CHECK constraint to include 'TENTATIVE', using the dynamic pg_constraint lookup pattern from 20260715000038_expand_role_model.sql.
Types: widen RsvpStatus in src/features/rsvps/rsvp.types.ts to 'YES' | 'NO' | 'TENTATIVE'.
API route (app/api/rsvps/route.ts): allow 'TENTATIVE' in the rsvp_status validation check.
Roster derivation (src/features/events/service.ts, getEventRoster): 3-way branch (YES → ACCEPTED, NO → DECLINED, TENTATIVE → TENTATIVE, none → NOT_RESPONDED). Widen RosterEntry['response'] type in the same file.
Web admin roster UI (app/admin/(shell)/events/[id]/EventDetail.tsx): add TENTATIVE: 'Tentative' to RESPONSE_LABELS, add 'TENTATIVE' to the filter-button array, widen the rosterFilter state type. Add a color/style for the Tentative badge in the roster table row consistent with existing Accepted/Declined treatment (reuse existing accent-style token, don't hardcode a new hex).
Report — new aggregate summary (report.repository.ts): add getRsvpReportSummary(tenantId, filters) returning per-event { event_id, event_name, yes_count, no_count, tentative_count, no_response_count }, built from the same event_attendees ⋈ rsvps join as getRsvpReport, grouped by event. Counts must reconcile to event_attendees total per event (FP-128 AC).
Report — existing detail rows (report.repository.ts getRsvpReport): widen rsvp_status type to include 'TENTATIVE', ternary → 3-way branch (mirrors step 4's fix). rsvp_reason stays null for anything other than NO (unchanged).
Report service (report.service.ts): add getRsvpReportSummary wrapper applying the same resolveLeaderScope RBAC pattern already used for getRsvpReport/getAttendanceReport.
New API route: app/api/reports/rsvp/summary/route.ts — same auth/RBAC shape as the existing app/api/reports/rsvp/route.ts, calls getRsvpReportSummary.
RSVP report UI (RsvpReportBrowser.tsx): add a summary view — per-event count row (Yes/No/Tentative/No response), displayed above or alongside the existing detail rows (exact layout — summary table vs. chips per event — left to implementation judgment per the story's "small design choice, not a blocker" note). Existing detail-row behavior stays intact (FP-128 AC: additive, not a replacement).

Files to Create/Modify

supabase/migrations/20260718000046_rsvp_tentative_status.sql (new)
src/features/rsvps/rsvp.types.ts
app/api/rsvps/route.ts
src/features/events/service.ts
app/admin/(shell)/events/[id]/EventDetail.tsx
src/features/reports/report.repository.ts
src/features/reports/report.service.ts
app/api/reports/rsvp/summary/route.ts (new)
app/admin/(shell)/reports/RsvpReportBrowser.tsx

Migration Files
sql-- DIP-FP-127-FP-128-web: widen rsvps.rsvp_status to add TENTATIVE.
--
-- Constraint name looked up dynamically via pg_constraint, matching the
-- precedent set in 20260715000038_expand_role_model.sql (members.role /
-- invitations.role) — do not hardcode "rsvps_rsvp_status_check" by
-- convention-guessing; verify it live instead.

DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  SELECT con.conname INTO v_constraint_name
  FROM pg_constraint con
  JOIN pg_attribute att
    ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
  WHERE con.conrelid = 'rsvps'::regclass
    AND con.contype = 'c'
    AND att.attname = 'rsvp_status';

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE rsvps DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END $$;

ALTER TABLE rsvps
  ADD CONSTRAINT rsvps_rsvp_status_check
  CHECK (rsvp_status IN ('YES', 'NO', 'TENTATIVE'));

-- rsvps_reason_required_check (rsvp_status = 'NO' requires rsvp_reason) is
-- unaffected — TENTATIVE falls through its OR clause exactly like YES does,
-- correctly requiring no reason. Not touched.
Branch Name
feature/FP-127-FP-128-web-rsvp-tentative
Commit Message
FP-127, FP-128: add TENTATIVE RSVP status + per-event RSVP count reporting (web)
Pull Request Description
Maps to acceptance criteria:

FP-127: "Tentative accepted with no reason required" → migration + API allow-list + service reason-check (already skips non-NO, confirmed). "Round-trips correctly" → roster derivation + report detail rows widened. "Leaders/Admins see Tentative in roster with distinct label/color" → EventDetail.tsx RESPONSE_LABELS + filter + badge style. "Existing Yes/No unchanged" → no existing branches removed, only extended.
FP-128: "Four counts sum to expected-attendee total" → getRsvpReportSummary grouped over the same event_attendees roster join FP-127 fixed. "Leader sees only assigned members' counts" → reuses resolveLeaderScope/getAssignedMemberIds, same pattern as the existing detail report. "Zero-RSVP events display correctly" → all-in-no_response_count, no special-casing needed since the join naturally produces this. "Existing FP-37 detail behavior preserved" → getRsvpReport kept, only its type/branch widened, not replaced.

Jira Linkage

PDEEpicID: FP-15 (EPIC-4, RSVP Management) / FP-36 (EPIC-9, Reporting & Metrics)
PDEStoryID: FP-127, FP-128

Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-127-FP-128-web.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against dev and stop. Do not merge — Joseph will merge to dev, then apply the migration manually in the Supabase SQL Editor, then test against the deployed dev environment. Flag the manual remote-migration-apply step explicitly in the PR description — this exact gap caused a live 500 on FP-134-web last session.
Include full diffs for every file in the completion report — not a summary.
