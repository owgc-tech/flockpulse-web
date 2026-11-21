# DIP — FP-265 adj-3 (Web): reset request page opened from the app goes back to the app, not the web login

### Not covered — deliberately excluded
- The mobile half (the app adds `?from=app` to the address it opens). That is `DIP-FP-265-mobile-adj-1.md`, repo `flockpulse-mobile`, sent AFTER this PR is merged and Vercel is Ready.
- The emailed link, `/reset-password/confirm` and `/reset-password/done`: unchanged. The done page already shows the Member message by role.
- `actions.ts` (`requestPasswordResetAction`) and its `redirectTo`: unchanged. The parameter is never put in the email.
- No migration, no Supabase change, no new package.

### Story Summary
The reset request page is shared by the web login ("Forgot password?") and the phone app. Its "Back to sign in" link goes to the web login, which Members cannot use, so a Member who came from the app lands on a page that rejects them. When the page is opened with `?from=app`, show a link back to the app instead of the web login, and tell the person to return to the app after resetting. Without the parameter nothing changes.

### Repo Target
Web (Next.js), `owgc-tech/flockpulse-web`. Independent of the mobile repo: an old phone build never sends the parameter, and an old web page ignores it.

### Grounding Check
READ on `origin/dev` = `8ba2e9a` (merge of #251) on 2026-11-21. Re-verify first; stop and report if different.
- `app/reset-password/page.tsx` is a Server Component with no props: it renders the heading, intro text and `<ResetRequestForm />`.
- `app/reset-password/ResetRequestForm.tsx` is a client component. It defines a local `BackToSignIn({ className })` that renders `<p className="text-center text-xs …"><a href="/login" …>Back to sign in</a></p>`, used in the success branch (`className=" mt-4"`) and at the end of the form.
- `app/reset-password/actions.ts` calls `supabase.auth.resetPasswordForEmail(email, { redirectTo: <SITE_URL>/reset-password/confirm })`. It does not read the query string and must not change.
- `src/features/auth/reset-password.ts` exports `ResetCredential`, `parseResetCredential`, `validateNewPassword`, `resetDoneVariant` (pure, no Next.js imports). `scripts/test-fp265-reset-flow.ts` tests them.
- Next.js is 16.4.6: in a page, `searchParams` is a `Promise` (see `app/admin/(shell)/events/page.tsx`, which does `await searchParams`).
- The mobile app's scheme is `flockpulse` (`app.json`, `"scheme": "flockpulse"`). `flockpulse://` opens the app. **Not verified on a device**; say so in the PR.
- No invariant domain rule, tenant rule, RBAC, API route or migration is involved. The parameter carries no secret and changes only wording and one link.

### Implementation Plan
1. **Pure helper in `src/features/auth/reset-password.ts`:** add `export function isFromApp(value: string | string[] | undefined): boolean` returning `true` only when `value === 'app'` (a string, exactly). Arrays, empty, other values: `false`. Also `export const APP_RETURN_URL = 'flockpulse://'`.
2. **`app/reset-password/page.tsx`:** accept `searchParams: Promise<{ from?: string | string[] }>`, `await` it, and pass `fromApp={isFromApp(from)}` to `<ResetRequestForm />`. Nothing else on the page changes.
3. **`ResetRequestForm.tsx`:** accept a `fromApp?: boolean` prop (default false).
   - `fromApp` false: rendering stays exactly as it is today (zero visible change).
   - `fromApp` true: `BackToSignIn` is replaced by a link `<a href={APP_RETURN_URL}>Back to the app</a>` with the same classes and spacing, in both the form state and the success state. In the success box add one more line under the existing text: "Then return to the FlockPulse app." (same classes as the other box text; not added when `fromApp` is false).
4. **Tests:** extend `scripts/test-fp265-reset-flow.ts` with `isFromApp`: `'app'` true; `'App'`, `'APP'`, `''`, `undefined`, `'web'`, `['app']` false. Keep every existing check passing.
5. Run `npx tsc --noEmit`, `npx eslint` on the changed files, and the test script. State plainly that the page was or was not opened in a browser, and that `flockpulse://` was not tested on a device.

### Files to Create/Modify
- Modify: `src/features/auth/reset-password.ts`, `app/reset-password/page.tsx`, `app/reset-password/ResetRequestForm.tsx`, `scripts/test-fp265-reset-flow.ts` (gitignored: `git add -f`).
- Create (docs): `documentation/dips/DIP-FP-265-web-adj-3.md`.
- Must stay untouched (show `git diff dev <branch> -- <file>` with zero output): `app/reset-password/actions.ts`, everything under `app/reset-password/confirm/` and `app/reset-password/done/`, `app/login/**`, `proxy.ts`.

### Migration Files (if applicable)
None.

### Branch Name
feature/FP-265-adj-3-reset-from-app

### Commit Message
FP-265: reset page opened from the app links back to the app

### Pull Request Description
Plain GitHub markdown. State: `?from=app` shows "Back to the app" (`flockpulse://`) instead of "Back to sign in", plus one "return to the app" line in the green box; without it nothing changes; email link and actions unchanged; deviations; not tested (browser, device hand-off of `flockpulse://`, dark mode). Manual steps for Joseph: (1) open `/reset-password`: "Back to sign in" as before; (2) open `/reset-password?from=app` on a phone with the app installed: the link says "Back to the app"; tap it and expect the app to open; request a reset and expect the green box with "Then return to the FlockPulse app." and the app link; (3) open `/reset-password?from=app` on a desktop browser: link shows, nothing else breaks.

### Jira Linkage
- PDEEpicID: FP-170
- PDEStoryID: FP-265 (adj-3)

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-265-web-adj-3.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Branch off current dev and open the PR with gh pr create --base dev; quote the base in your report and do NOT stack it on any other branch. No migration and no merge: Joseph merges manually. Do not run git commands in a folder Claude Code is using; wait for its report. Include full diffs for every file in your completion report per Section 5, rule 13, not a summary.
