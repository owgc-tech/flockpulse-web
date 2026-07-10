**DIP-FP-73-FP-74-adj-1**

Add a standing "Bulk Reassign" entry point to the Member Edit screen, visible whenever the member is active — not only reachable reactively via the blocked-deactivation error message. Today `/admin/members/[id]/reassign` only gets linked to from inside the 409 error banner, meaning an Admin who wants to proactively clear out a Leader's members before deactivating has no way to get there.

**Design, keeping it consistent with what's already built:**
- `BulkReassignForm.tsx` already handles the "zero members currently assigned" case gracefully (empty-state message, disabled dropdown/button) — so the new link can be shown unconditionally on the Edit screen without needing to pre-check whether the member has anyone assigned. No new guard logic needed.
- Small discoverability improvement worth including: show the current assignee count next to the link (e.g., "Bulk Reassign (2 members)"), so an Admin can tell at a glance whether it's relevant, rather than clicking through and discovering an empty list. This requires one new read in `page.tsx` — `getMembersAssignedToLeader(id, tenantId)`, already exists from FP-73, just not currently called from this screen.

**Implementation:**
1. `app/admin/(shell)/members/[id]/edit/page.tsx`: add `getMembersAssignedToLeader(id, tenantId)` to the existing `Promise.all(...)` fetch, pass the resulting count down as a new `assignedMemberCount` prop to `MemberEditForm`.
2. `MemberEditForm.tsx`: render a persistent link to `/admin/members/${member.id}/reassign` — visible whenever `!isDeactivated` (matching the Deactivate section's own visibility condition, since a deactivated member can't meaningfully be reassigned-from anymore). Label it "Bulk Reassign" with the count appended, e.g. `Bulk Reassign (${assignedMemberCount} member${assignedMemberCount === 1 ? '' : 's'})` when count > 0, or plain "Bulk Reassign" with a muted "no members currently assigned" hint when count is 0 — don't hide the link entirely at zero, since an Admin may still want to confirm that state directly.
3. Placement: alongside or near the existing Pastoral Leader field section, not buried inside the Deactivate danger-zone card — this is a routine action, not a destructive one, and shouldn't visually inherit the danger-zone's styling.
4. No backend changes — this is purely wiring an existing read and an existing route into a screen that already has both available.

**Verification:** confirm the link appears for an active member regardless of assignee count, confirm it's absent (or clearly disabled/non-actionable) for an already-deactivated member, and confirm clicking through with 0/1/N assigned members each render correctly on the destination screen (already covered by existing FP-73/74 test coverage for the destination screen itself — no new test script needed unless you want one specifically asserting the link's presence/count on the Edit screen).

**Stop Point:** Save this adjustment verbatim to `documentation/dips/DIP-FP-73-FP-74-adj-1.md` (small fixes like this go in the adj-file per Section 5's convention, not folded silently into the original DIP record). Branch off `dev` as `feature/FP-73-FP-74-adj-1-bulk-reassign-nav-link`, commit as `FP-73-FP-74-adj-1: add standing Bulk Reassign nav link to Member Edit screen`, open PR against `dev`, stop — same review-before-merge workflow as always.
