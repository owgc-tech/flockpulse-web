DIP-FP-141.md
Story Summary
Formation Member Progress shows every tenant member to Leader-tier viewers, with zero pastoral-leader scoping anywhere in the feature — confirmed as a genuine access-control gap, not cosmetic. Grounding for this DIP found the problem is actually in three places, not one: (1) the page-level member list is unscoped, (2) the per-member progress-detail Server Action has no member-scoping check either — a Leader-tier caller could call it directly with an arbitrary memberId and get that member's formation data regardless of any pastoral relationship, and (3) there's a third Server Action, listMembersAction, that is dead code (zero callers anywhere in the repo) with no auth check of any kind — it accepts a caller-supplied tenantId directly and would leak cross-tenant member data to anyone who invoked it directly, bypassing the UI entirely. This DIP scopes (1) and (2), and deletes (3) rather than patching something with no legitimate caller.
Repo Target
Web (Next.js) — owgc-tech/flockpulse-web.
Grounding Check
Confirmed live against dev:

page.tsx calls listMembers(tenantId) unconditionally, passes the full list straight to FormationProgressBrowser — no leader-scoping.
FormationProgressBrowser.tsx does not call listMembersAction at all (it only calls getMemberProgressAction and recordManualCompletionAction) — it consumes members purely as the prop from page.tsx.
getMemberProgressAction (in actions.ts) already has its own auth check (getCallerContext + isLeaderTierOrAbove + tenant match) — correctly guards against an unauthenticated or cross-tenant caller, per this file's own stated reasoning about Server Actions being independently callable. But it never checks that the requested memberId is one the Leader-tier caller is actually scoped to — computeAllCoursesProgress(memberId, tenantId) itself does no scoping either (confirmed: it only filters by tenant, nothing else). So even after fixing the page-level list, a Leader-tier user could still retrieve any tenant member's progress by calling this action directly with a different memberId.
listMembersAction — confirmed via repo-wide grep — has zero callers anywhere, not even from within its own feature's UI. It has no auth check at all (unlike its two sibling actions in the same file), and takes tenantId as a plain caller-supplied argument with nothing verifying it matches the actual caller's tenant. Given it's unused, this DIP deletes it rather than adding scoping to something with no legitimate purpose — matching the principle that dead, unauthenticated code is a liability even if nothing currently calls it.
recordManualCompletionAction is already correctly Admin-tier-gated (isAdminTier(ctx.role)) and tenant/actor-matched — confirmed unaffected by this story's scope, no change needed.
Reuses isExactlyLeaderTier/getAssignedMemberIds exactly as every other report this session (resolveLeaderScope in report.service.ts) — no new RBAC mechanism invented.
Domain rules: no conflict — read-side scoping fix plus removal of unused, insecure dead code. No change to recordManualCompletion's Admin-only write path.

Implementation Plan

page.tsx: after resolving role/memberId, if isExactlyLeaderTier(role), call getAssignedMemberIds(tenantId, memberId) and filter the listMembers(tenantId) result down to that set before passing to FormationProgressBrowser. Admin-tier: unchanged, full list.
actions.ts — getMemberProgressAction: after the existing auth check, if the caller is Leader-tier (not Admin-tier), fetch getAssignedMemberIds(tenantId, ctx.memberId) and verify the requested memberId is in that set — throw Unauthorized (same error shape already used in this function) if not. Admin-tier callers: unchanged.
actions.ts — delete listMembersAction entirely — confirmed dead code, no callers, no legitimate use; removing it closes the unauthenticated cross-tenant exposure outright rather than patching something nothing calls.
recordManualCompletionAction: no change — confirmed already correctly scoped and out of this story's stated scope.

Files to Create/Modify

app/admin/(shell)/formation-progress/page.tsx
app/admin/(shell)/formation-progress/actions.ts

Migration Files
Not applicable — reuses existing assignments table and getAssignedMemberIds() as-is.
Branch Name
feature/FP-141-formation-progress-leader-scoping
Commit Message
FP-141: scope Formation Member Progress to Leader-tier's assigned members; remove unauthenticated dead action
Pull Request Description
Maps to acceptance criteria:

"Leader-tier sees only their assigned members" → page.tsx's list scoping via getAssignedMemberIds.
"Admin-tier unaffected" → isAdminTier branch, unchanged behavior.
"Record completion unaffected" → recordManualCompletionAction untouched, confirmed already correctly gated.
"Verify no other independent member-fetching exists" → found two additional issues beyond the page-level list: getMemberProgressAction's missing per-member scope check (now fixed) and listMembersAction's complete lack of auth (now deleted, since it was dead code). Flagging both explicitly since neither was anticipated by the original ticket text.

Jira Linkage

PDEEpicID: FP-28 (EPIC-7 — Formation Tracking Engine)
PDEStoryID: FP-141

Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-141.md, frozen after save. npm run build must pass cleanly. Open PR against dev, do not merge. No migration, no remote step. Flag the listMembersAction deletion clearly in the PR description — it's a security-motivated removal of dead code, not an oversight, and worth Joseph knowing about explicitly given it wasn't in the original ticket.
Include full diffs for every file in the completion report.
