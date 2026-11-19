Story Summary
FlockPulse currently lands admin/leader users on /admin/invitations after login (both the normal MFA-challenge flow and first-time MFA enrollment), and also seeds that same page as the implicit "no explicit destination" default inside the next-param plumbing. Joseph wants the default landing page to be /admin/events instead. This is a pure redirect-target swap — no change to the Invitations page, no change to the override mechanism that lets a user land on a specific originally-requested route.
Repo Target
Web (Next.js, owgc-tech/flockpulse-web) — this is entirely within the existing web app; no mobile or backend involvement.
Grounding Check

Confirmed live via raw.githubusercontent.com against dev branch (not from the manifest or ticket description alone).
Three hardcoded occurrences of /admin/invitations as a destination found (ticket description named two; a third was found in grounding — see Story Summary):

app/login/mfa-challenge/actions.ts:68
app/admin/mfa-enroll/actions.ts:79
app/login/mfa-challenge/page.tsx:21


AdminSidebar.tsx:52 also references /admin/invitations but only as the nav link label/href — explicitly out of scope per the story's AC ("No change to the Invitations page itself").
No schema/table/column names involved — this story touches only redirect strings in application code, so Section 2's schema-verification rule doesn't apply here.
No domain-rule conflicts (Section 4) — this story doesn't touch attendance, RBAC scoping logic, or tenant derivation.
No migrations, no atomicity concerns, no new error codes.

Implementation Plan

In app/login/mfa-challenge/page.tsx, change the destructuring default for next from /admin/invitations to /admin/events. This is the root of the fallback chain — fix it first so actions.ts doesn't need special-casing for the "no next param" case.
In app/login/mfa-challenge/actions.ts, change the literal fallback in const destination = next && next.startsWith('/admin') ? next : '/admin/invitations'; to '/admin/events'. Leave the next.startsWith('/admin') override logic completely untouched — that's the "originally-requested route" mechanism the AC requires to be preserved.
In app/admin/mfa-enroll/actions.ts, change the literal redirect('/admin/invitations'); to redirect('/admin/events');. Update the adjacent comment (// On success: promotes session to aal2, sets MFA trust cookie, redirects to /admin/invitations.) to match.
Do not touch AdminSidebar.tsx — the Invitations nav link stays exactly as-is.
Run npm run build and confirm it passes cleanly before pushing (mandatory per DIP rule 5.1 whenever .ts/.tsx is touched).

Files to Create/Modify

app/login/mfa-challenge/page.tsx (modify)
app/login/mfa-challenge/actions.ts (modify)
app/admin/mfa-enroll/actions.ts (modify)

Migration Files (if applicable)
None.
Branch Name
feature/FP-169-default-landing-events
Commit Message
FP-169: default post-login landing page to /admin/events instead of /admin/invitations
Pull Request Description
Maps to FP-169's acceptance criteria:

"Both redirect targets change from /admin/invitations to /admin/events" — done in actions.ts (mfa-challenge) and actions.ts (mfa-enroll); a third occurrence in page.tsx's next default was also found live and fixed for consistency, since it feeds the same fallback chain.
"next param override logic preserved unchanged" — next.startsWith('/admin') ? next : ... in mfa-challenge/actions.ts untouched; only the literal fallback string changed.
"No change to the Invitations page itself" — AdminSidebar.tsx and the Invitations route/page are untouched. git diff dev [branch] -- src/components/admin/AdminSidebar.tsx should show zero output.

Jira Linkage

PDEEpicID: FP-5
PDEStoryID: FP-169

Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-169.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against dev and stop. Do not merge — the user will check out the branch locally, test it, and merge manually.
Include full diffs for every file in your completion report per Section 5, rule 12 — not a summary. Include git diff dev [branch] -- src/components/admin/AdminSidebar.tsx showing zero output as proof it was left untouched.
