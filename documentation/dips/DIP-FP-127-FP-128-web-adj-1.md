DIP-FP-127-FP-128-web-adj-1.md
Story Summary
Post-merge fix to PR #82 (DIP-FP-127-FP-128-web). The original migration widened rsvps_rsvp_status_check to permit TENTATIVE but missed that rsvps_reason_required_check — a separate constraint on the same table — also needed widening. Its OR clause is an allowlist covering only YES and NO-with-reason; TENTATIVE matched neither branch and every attempt to submit a Tentative RSVP failed in production with a 23514 check_violation, confirmed in live Vercel function logs.
Repo Target
Web (Next.js) — owgc-tech/flockpulse-web.
Grounding Check
Live production error confirmed the exact failure mode: rsvps_reason_required_check violated on a row with rsvp_status = TENTATIVE, rsvp_reason = null. This is a correction to DIP-FP-127-FP-128-web's own (incorrect) grounding claim that this constraint was unaffected. No other constraint, RLS policy, or RPC internal check references rsvp_status by value — confirmed via full-repo grep this session — so this is the only remaining gap.
Implementation Plan

New migration: drop and re-add rsvps_reason_required_check with a third OR branch for TENTATIVE.
No application code changes — this is a pure schema fix; the API/service layer already passes TENTATIVE through correctly and never sends a reason for it.

Files to Create/Modify

supabase/migrations/20260718000047_rsvp_reason_check_tentative_fix.sql (new)

Migration Files
sql-- DIP-FP-127-FP-128-web-adj-1: rsvps_reason_required_check never accounted
-- for TENTATIVE — it's a two-branch allowlist (YES, or NO-with-reason), not
-- an exclusion rule, so a TENTATIVE/null row satisfied neither branch and
-- was rejected with check_violation (23514). Confirmed live in Vercel
-- function logs, 2026-07-18 04:11:33 UTC, before this fix was written.
-- Root-cause misdiagnosis in DIP-FP-127-FP-128-web's own grounding check —
-- corrected here.

ALTER TABLE rsvps DROP CONSTRAINT IF EXISTS rsvps_reason_required_check;

ALTER TABLE rsvps
  ADD CONSTRAINT rsvps_reason_required_check
  CHECK (
    rsvp_status = 'YES'
    OR rsvp_status = 'TENTATIVE'
    OR (rsvp_status = 'NO' AND rsvp_reason IS NOT NULL AND btrim(rsvp_reason) <> '')
  );
Branch Name
feature/FP-127-FP-128-web-adj-1-reason-check-fix
Commit Message
FP-127, FP-128: fix rsvps_reason_required_check to permit TENTATIVE
Pull Request Description
Fixes a production bug from PR #82: submitting a Tentative RSVP failed with a 23514 check_violation on rsvps_reason_required_check, which never accounted for the new TENTATIVE value. Confirmed via live Vercel logs. Schema-only fix, no app code touched.
Jira Linkage

PDEEpicID: FP-15 (EPIC-4) / FP-36 (EPIC-9)
PDEStoryID: FP-127, FP-128

Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-127-FP-128-web-adj-1.md, frozen after save. Validate the migration locally via supabase db reset before opening the PR. Open PR against dev, do not merge. Flag the remote-apply step explicitly again in the PR description — same manual Supabase SQL Editor step as before.
