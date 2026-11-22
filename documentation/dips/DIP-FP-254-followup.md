Small web change, FP-254 follow-up. This REPLACES the earlier redirect-only instruction; use this one.
Branch off CURRENT dev (PR #253 is merged) as feature/FP-254-accept-redirect-login-link. Do NOT stack. Open the PR with gh pr create --base dev and quote the base in your report. Do not merge. No migration.
First save this instruction verbatim to documentation/dips/DIP-FP-254-followup.md and add nothing to it afterward.

1. Redirect bug: after accepting on /accept-terms the user lands on /admin, which has no page (404). Change both redirect('/admin') in app/accept-terms/actions.ts and app/accept-terms/page.tsx to redirect('/'). (The root page forwards to /admin/community.) Verify first that app/admin has no page.tsx and that app/page.tsx redirects to /admin/community.

2. Login link on the registration-complete screen, app/register/complete/CompleteProfileForm.tsx. Today only role === 'ADMIN' gets the "Continue to Login" button; Leaders get only text. Change it so the "Continue to Login" button (same style, goes to /login) shows for every role EXCEPT Member.
   - Verify first which role values app_metadata.role can hold in this flow (ADMIN, LEADER, MEMBER, and any Admin-tier synonyms such as SR_COORDINATOR, COORDINATOR, COMMUNITY_SERVANT in src/lib/auth/middleware). If isLeaderTierOrAbove is safe to import in a client component, use it; if not, put a small pure helper in its own file. Do not import server-only code into the client component.
   - Member stays exactly as today (text only, no button).
   - Admin keeps today's wording. Leader (and other leader-tier roles) keep the existing "Your admin will follow up separately with an invitation to install the FlockPulse mobile app..." paragraph, with the button added above it. If you are not sure the Admin paragraph fits a Leader, keep the existing Leader paragraph and tell me.
   - Put the decision in a pure helper and test it: ADMIN yes, LEADER yes, MEMBER no, leader-tier synonyms yes, null/unknown no.

Run tsc, run scripts/test-fp254-acceptance.ts and your new test (update the old script only if it asserts the old redirect). Show the full git diff for every file. Say plainly what you could not test (no browser). PR description in plain GitHub markdown with the manual steps for Joseph.
