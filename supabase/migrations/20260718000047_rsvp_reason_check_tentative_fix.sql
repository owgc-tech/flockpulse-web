-- DIP-FP-127-FP-128-web-adj-1: rsvps_reason_required_check never accounted
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
