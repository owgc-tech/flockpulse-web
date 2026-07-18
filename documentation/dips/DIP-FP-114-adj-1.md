DIP-FP-114-adj-1.md
Story Summary
Post-launch bug found by Joseph while testing role-based login: any account with a role other than the literal string 'ADMIN' (Leader, Pastoral Leader, and the Admin-tier synonyms from FP-113 — Sr. Coordinator, Coordinator, Community Servant) can complete the password step and the MFA challenge, but gets bounced back to /login the instant the browser lands on an /admin/* page. Root cause: proxy.ts still does a literal role !== 'ADMIN' comparison, never updated when login/actions.ts was widened to isLeaderTierOrAbove() under FP-114. Only accounts with the exact 'ADMIN' role string ever pass the proxy's gate.
Repo Target
Web (Next.js) — owgc-tech/flockpulse-web.
Grounding Check
Confirmed live, traced end-to-end against dev:

login/actions.ts already uses isLeaderTierOrAbove(role) (from src/lib/auth/middleware.ts) — correct, already fixed under FP-114, not touched here.
login/mfa-challenge/actions.ts has no role check at all — correctly so, it's purely "did the TOTP code verify," not a place role should be checked.
proxy.ts has the sole remaining literal check: if (role !== 'ADMIN') { return NextResponse.redirect(new URL('/login', req.url)); } — this runs on every /admin/* request, including the one immediately following a successful MFA redirect, and is the actual point of failure.
isLeaderTierOrAbove(role) is already exported from src/lib/auth/middleware.ts and is exactly the right replacement — matching the same gate login/actions.ts already uses, so a user who's allowed to start logging in is also allowed to land in /admin once they've completed MFA. No new helper needed.
This does not weaken per-page or per-API authorization. Finer-grained restriction (which admin pages a Leader-tier user can actually see, which API routes are Admin-only) is already handled at a different layer — AdminSidebar.tsx's adminOnly flags and requireRole('ADMIN')/requireRole('LEADER') on individual API routes, both untouched by this fix. proxy.ts's job is only "can this session enter /admin at all," which is exactly what FP-114 intended to widen.
One loose end worth a second look, not fixed here: the comment directly above the /admin/mfa-enroll bypass says "the enrollment destination for first-time Admins" — once this fix lands, first-time Leader-tier logins will also correctly reach this bypass (since they'll now get past the role check first). The comment's wording is just stale, not a logic bug — the code itself doesn't gate mfa-enroll by role, so no behavior change is needed, only worth a comment fix while in the file.

Implementation Plan

proxy.ts: import isLeaderTierOrAbove from src/lib/auth/middleware.ts. Replace if (role !== 'ADMIN') with if (!role || !isLeaderTierOrAbove(role as Role)), matching login/actions.ts's exact pattern (including the !role guard for an unexpectedly missing claim).
Comment fix (same file, no logic change): update "the enrollment destination for first-time Admins" to "first-time Leader-tier-or-above accounts," reflecting what the code now actually does.

Files to Create/Modify

proxy.ts

Migration Files
Not applicable.
Branch Name
feature/FP-114-adj-1-proxy-leader-tier-login
Commit Message
FP-114: fix proxy.ts still gating /admin on literal role === 'ADMIN'
Pull Request Description
Fixes a production bug: Leader-tier and Admin-tier-synonym accounts (Sr. Coordinator, Coordinator, Community Servant, Pastoral Leader) could pass the password step and MFA challenge but were bounced back to /login by proxy.ts's stale literal role check. Now uses the same isLeaderTierOrAbove() rank check already used at the password step, so a session that's allowed to start logging in is also allowed to land in /admin after MFA. No change to per-page/API authorization — those remain independently gated.
Jira Linkage

PDEEpicID: FP-5 (EPIC-1 — Tenant & Access Control)
PDEStoryID: FP-114

Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-114-adj-1.md, frozen after save. npm run build must pass cleanly. Open PR against dev, do not merge. No migration, no remote step. Given this is an auth-gating fix, flag clearly in the PR description that this should be tested with a non-Admin, non-literal-ADMIN role (Leader or one of the FP-113 synonyms) all the way through password → MFA → landing on an actual /admin page, not just that the build passes.
Include full diffs in the completion report.
