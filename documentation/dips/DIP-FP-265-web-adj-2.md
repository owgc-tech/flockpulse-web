# DIP — FP-265 adj-2 (Web): "Back to sign in" link on the "Check your inbox" box

### Not covered — deliberately excluded
- Mobile "Forgot password?" link (separate DIP, repo `flockpulse-mobile`).
- Any change to the reset logic, actions, confirm page, done page, helper or tests. Wording of existing messages does not change.
- No migration, no Supabase change, no new package.

### Story Summary
On the reset request page, after the member asks for a reset email, the green "Check your inbox" box replaces the form. The form has a "Back to sign in" link, but the green box does not, so the person is stuck on the page. Add the same link under the green box.

### Repo Target
Web (Next.js), `owgc-tech/flockpulse-web`. Independent of the mobile DIP.

### Grounding Check
READ on `origin/dev` on 2026-11-21 (re-verify first; stop and report if different):
- `app/reset-password/ResetRequestForm.tsx` is a client component. When `state.success` is true it returns only the green box (`<div className="rounded-lg border border-green-200 bg-green-50 p-4 ...">` with "Check your inbox" and "We sent a password reset link to your email address."). In the normal form state, the last element is `<p className="text-center text-xs text-zinc-400 dark:text-zinc-600"><a href="/login" className="underline hover:text-zinc-600 dark:hover:text-zinc-400">Back to sign in</a></p>`.
- `app/reset-password/page.tsx` renders the heading, intro text and `<ResetRequestForm />` and needs no change.
- No invariant domain rule, tenant rule, RBAC rule, migration or API route is involved.

### Implementation Plan
1. In `ResetRequestForm.tsx`, in the `state.success` branch, wrap the green box and a link in a fragment (or a `div`) so the green box stays exactly as it is, and add below it the same `<p>` with the same `<a href="/login">Back to sign in</a>` and the same classes as the one in the form, with `mt-4` added to the `<p>`.
2. To avoid duplicating markup, you may extract the link into a small local component in the same file used in both places. Keep the rendered result identical in the form state.
3. Run `npx tsc --noEmit` (clean) and `npx tsx scripts/test-fp265-reset-flow.ts` (must pass as before). Say plainly that the page itself was not opened in a browser unless you did so.

### Files to Create/Modify
- Modify: `app/reset-password/ResetRequestForm.tsx` only.
- Create (docs): `documentation/dips/DIP-FP-265-web-adj-2.md` (see Stop Point).
- Must stay untouched (show `git diff dev <branch> -- <file>` with zero output): `app/reset-password/page.tsx`, `app/reset-password/actions.ts`, everything under `app/reset-password/confirm/` and `app/reset-password/done/`, `src/features/auth/reset-password.ts`.

### Migration Files (if applicable)
None.

### Branch Name
feature/FP-265-adj-2-reset-back-to-login

### Commit Message
FP-265: add Back to sign in link to the Check your inbox box

### Pull Request Description
Plain GitHub markdown. State: the green box now has the same "Back to sign in" link as the form; nothing else changed; deviations (if any); not tested (browser, dark mode unless checked). Manual steps for Joseph: open `/reset-password`, request a reset, expect the green box with a "Back to sign in" link under it that goes to `/login`; check the link is readable in dark mode.

### Jira Linkage
- PDEEpicID: FP-170
- PDEStoryID: FP-265 (adj-2)

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-265-web-adj-2.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Branch off current dev and open the PR with gh pr create --base dev; quote the base in your report and do NOT stack it on any other branch. No migration and no merge: Joseph merges manually. Do not run git commands in a folder Claude Code is using; wait for its report. Include full diffs for every file in your completion report per Section 5, rule 13, not a summary.
