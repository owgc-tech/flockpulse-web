DIP-FP-189-web-adj-1

Story Summary
Four fixes from real-device testing. First, a genuine reversal: guest_count
becomes Yes-only, no longer Yes/Tentative — a real database constraint
change, not just a UI tweak, since existing Tentative rows with a
guest_count would violate the tightened constraint if not cleaned up first.
Second: guest_count is added to the event roster response (currently
absent entirely), so both web and mobile can show per-invitee guest counts.
Third: the RSVP report's already-computed total_guests (added in the
original DIP, confirmed live, but never wired into the actual displayed
table) gets a real "Guests" column between Yes and No. Fourth: the
guest-count rejection logic in rsvp.service.ts is extended to also reject
Tentative, not just No.

Repo Target
Web (Next.js), owgc-tech/flockpulse-web. Fresh branch off current dev.

Grounding Check
- Confirmed live: rsvps_guest_count_status_check currently allows
  rsvp_status IN ('YES', 'TENTATIVE'). Tightening to 'YES' only will reject
  the ALTER TABLE if any existing row has rsvp_status = 'TENTATIVE' AND
  guest_count IS NOT NULL — the migration must clean this up first with an
  UPDATE, not just change the constraint and hope nothing conflicts.
- Confirmed live: getEventRoster()'s rsvps query selects only
  'member_id, rsvp_status, rsvp_reason' — guest_count is genuinely absent,
  not just unused. Both the query and the RosterEntry interface (line 919)
  need extending.
- Confirmed live: total_guests is already computed and returned by the
  RSVP report's repository function (report.repository.ts line 129) — this
  was done correctly in the original FP-189-web DIP. The gap is entirely
  in RsvpReportBrowser.tsx, which never added it to its local row type or
  rendered a column for it. This is a pure UI wiring gap, not a missing
  backend piece.
- rsvp.service.ts's existing gating (Step 5) only rejects guest_count when
  rsvp_status === 'NO' — extending this to reject whenever rsvp_status is
  anything other than 'YES' (i.e., also TENTATIVE) is a small, precise
  change to an existing, already-correct pattern, not new logic.

Implementation Plan
1. Migration: 
   - UPDATE rsvps SET guest_count = NULL WHERE rsvp_status = 'TENTATIVE'
     AND guest_count IS NOT NULL; (data cleanup, must run first, idempotent).
   - DROP + re-ADD rsvps_guest_count_status_check with
     CHECK (guest_count IS NULL OR (rsvp_status = 'YES' AND guest_count >= 0)).
2. rsvp.service.ts: Step 5's guest_count rejection changes from
   rsvpStatus === 'NO' to rsvpStatus !== 'YES' (rejects both NO and
   TENTATIVE now, matching the tightened database constraint exactly).
3. getEventRoster() (service.ts): add guest_count to the rsvps SELECT, the
   Map's value type, and the final RosterEntry object construction.
   RosterEntry (line 919) gains guest_count: number | null.
4. RsvpReportBrowser.tsx: local row type gains total_guests: number,
   matching the report.repository.ts field already returned. New "Guests"
   <th>/<td> column inserted between the existing Yes and No columns.

Files to Create/Modify
- supabase/migrations/[next]_rsvp_guest_count_yes_only.sql (new)
- src/features/rsvps/rsvp.service.ts (modify — Step 5's condition)
- src/features/events/service.ts (modify — getEventRoster, RosterEntry)
- app/admin/(shell)/reports/RsvpReportBrowser.tsx (modify — Guests column)

Migration Files
Full SQL at implementation time per the Implementation Plan above.

Branch Name
feature/FP-189-web-adj-1-guest-count-fixes

Commit Message
FP-189-web-adj-1: guest_count Yes-only (reversal), expose on roster, wire total_guests into the RSVP report UI

Pull Request Description
- Confirm the data-cleanup UPDATE genuinely ran before the constraint
  tightened, by checking the migration's own statement order.
- Confirm a live attempt to submit guest_count on a Tentative RSVP now
  returns a clean rejection, not a raw database error.
- Screenshot the RSVP report showing the new Guests column with a real
  non-zero value.

Jira Linkage
- PDEEpicID: FP-15
- PDEStoryID: FP-189

Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-189-web-adj-1.md.
Branch off current dev. Open a PR against dev and stop. Do not merge.

Include full diffs for every file in the completion report, no elisions.
