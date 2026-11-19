DIP-FP-141-adj-1.md
Story Summary
Post-merge fix to PR #90 (DIP-FP-141). Joseph confirmed the Leader-tier scoping works correctly, but noted a gap: a Leader-tier member should also see themselves in Formation Member Progress, not only the members they pastorally lead. getAssignedMemberIds() returns only members assigned to the leader — it has no reason to include the leader's own memberId, since that function's job elsewhere (RSVP/Attendance reports) is purely "who does this leader lead," not "who can this leader see." This DIP adds the leader's own memberId to the scoped set in both places DIP-FP-141 added scoping.
Repo Target
Web (Next.js) — owgc-tech/flockpulse-web.
Grounding Check
Confirmed live against dev (PR #90 merged): both page.tsx's list-filtering and actions.ts's getMemberProgressAction scoping check use getAssignedMemberIds(tenantId, memberId) as the sole source of "which members can this Leader-tier caller see" — neither includes the caller's own memberId. This is correct behavior for getAssignedMemberIds() itself (its contract elsewhere, e.g. resolveLeaderScope in report.service.ts, is genuinely "assigned members only," and changing that shared function's behavior would affect every report built this session) — so the fix belongs in Formation Member Progress's own two call sites, not in getAssignedMemberIds() itself.
Implementation Plan

page.tsx: after building assignedMemberIds from getAssignedMemberIds(), add the caller's own memberId to the set before filtering.
actions.ts — getMemberProgressAction: widen the authorization check so a Leader-tier caller is also allowed when memberId === ctx.memberId (viewing their own progress), in addition to the existing assigned-members check.

Files to Create/Modify

app/admin/(shell)/formation-progress/page.tsx
app/admin/(shell)/formation-progress/actions.ts

Migration Files
Not applicable.
Branch Name
feature/FP-141-adj-1-leader-sees-self
Commit Message
FP-141: Leader-tier should also see their own formation progress
Pull Request Description
Fixes a gap Joseph found immediately after testing PR #90: Leader-tier scoping correctly showed assigned members but incorrectly excluded the leader's own record. Both the page-level list and the per-member action's authorization check now include the caller's own memberId alongside their assigned members.
Jira Linkage

PDEEpicID: FP-28 (EPIC-7 — Formation Tracking Engine)
PDEStoryID: FP-141

Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-141-adj-1.md, frozen after save. npm run build must pass cleanly. Open PR against dev, do not merge. No migration, no remote step.
Include full diffs for every file in the completion report.
