# DIP — FP-265 (Web): fix password reset "No active session", use a token-in-link reset, and member-friendly wording

### Not covered — deliberately excluded
- **The mobile "Forgot password?" link.** That is the second DIP for FP-265 (repo `flockpulse-mobile`). It is sent only after this DIP is merged AND Joseph has changed the Supabase reset email template (see "Manual Supabase step").
- **MFA changes for Members** (making MFA optional). Separate decision, separate story. Do not touch any MFA code.
- **The "Coming soon" site gate** (`src/lib/site-gate.ts`, `GATE_PUBLIC_PATHS`). Unchanged. After public launch (`FP_PUBLIC_LAUNCH=true`) the gate is off; before it, the reset pages are hidden on flockpulse.ca only. Leave it.
- **No migration.** No database change. Do not touch `supabase/migrations/`.
- **No change to `app/reset-password/page.tsx`, `ResetRequestForm.tsx` or `app/reset-password/actions.ts`** (the "request a reset email" half). `redirectTo` stays `${NEXT_PUBLIC_SITE_URL}/reset-password/confirm`.

### Story Summary
Password reset is broken for everyone. The emailed link opens `/reset-password/confirm?code=...`; the page exchanges the code for a session inside a Server Component, which cannot write cookies, so the browser never receives the session and "Set new password" answers "No active session. Please request a new reset link." Auth logs on `fpdb-dev` (2026-11-21, ~09:25 and ~09:27 Toronto time) show the recovery code accepted and no password-update event afterwards, which matches this. Separately, the current link only works in the same browser that asked for the reset (PKCE code verifier cookie), so a link opened in another browser, app or device fails. This DIP moves the credential check into the one server action that sets the password (a Server Action CAN set cookies), makes the emailed link carry a token (`token_hash`) that works in any browser, stops viewing the page from consuming the link, and fixes the wording after success so Members (who use the phone app, not the website) are told to return to the app.

### Repo Target
Web (Next.js, `owgc-tech/flockpulse-web`). No dependency on the mobile repo to ship this. The mobile DIP depends on this one.

### Grounding Check
Everything below was READ in `flockpulse-web` at `origin/dev` = `f5cb131` (Nov 20) in the planning session on Nov 21. **Re-verify each claim first, on current `dev`. If any is wrong, stop and report before coding.**
- `app/reset-password/confirm/page.tsx` is a Server Component. It reads `searchParams.code`, calls `createSupabaseServerClient()` then `exchangeCodeForSession(code)` on page load, and renders `ResetConfirmForm` when there is no error.
- `src/lib/supabase/server.ts`: `setAll` wraps `cookieStore.set` in `try/catch` and silently ignores failure ("setAll called from a Server Component"). Its comment says the proxy handles refresh for `/admin/*`.
- `proxy.ts` only protects `/admin/*`; everything else returns `NextResponse.next()` after the site-gate check. So nothing persists the session for `/reset-password/confirm`.
- `app/reset-password/confirm/actions.ts` `confirmPasswordResetAction`: validates (min 8, match), `getSession()`, returns "No active session…" if none, `updateUser({ password })`, then `createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).auth.admin.signOut(session.access_token, 'global')`, deletes cookie `fp_mfa_expires_at`, `redirect('/login')`.
- `app/reset-password/actions.ts` `requestPasswordResetAction` calls `resetPasswordForEmail(email, { redirectTo: \`${NEXT_PUBLIC_SITE_URL ?? ''}/reset-password/confirm\` })`, returns a generic error only on failure.
- `ResetConfirmForm.tsx` is a client component using `useActionState(confirmPasswordResetAction, {})`. Fields: `password`, `confirmPassword`.
- `confirm/page.tsx` copy says "After updating, you'll be asked to verify with your authenticator app." (wrong for Members).
- Versions: `next` 16.4.6, `@supabase/ssr` ^0.12.7, `@supabase/supabase-js` ^2.119.0. `isLeaderTierOrAbove(role: Role)` is exported from `src/lib/auth/middleware.ts`.
- Prior work: `documentation/dips/DIP-FP-108-FP-109.md` introduced the current page-level exchange. That DIP is the reason the design is what it is; read it. **Not known:** why this appeared to work when FP-108 shipped. The Next.js upgrade of Nov 18 (FP-241) is one unverified guess. Do not assume; see step 0.
- **Not verified (cannot be read from code):** the current Supabase "Reset Password" email template text, the project's allowed redirect URLs, and whether `{{ .RedirectTo }}` is available in templates. Joseph handles these in the dashboard (see "Manual Supabase step").
- Invariants: no change to tenant, attendance, RBAC or removal rules. Tenant ID is not involved. The service-role client is already used in this action for global sign-out; keep that and do not widen it. Never log the token, code, password or email. API-only data access (FP-228) is not affected. This is a web page and Server Action, not an API endpoint the phone calls, so the JSON-envelope rule does not apply.

### Implementation Plan
**0. Reproduce first (local, no hosted database).** With `supabase start` and `npm run dev:local` (FP-263 guard in force), request a reset for a local test user, read the email in Inbucket (`http://127.0.0.1:54324`), open the link, submit a new password. Record whether it reproduces "No active session". If it does NOT reproduce locally, stop and report with what you saw; do not proceed on the assumption. If it does, continue.

**1. Pure helper, new file `src/features/auth/reset-password.ts`** (no Next.js or Supabase imports):
- `type ResetCredential = { kind: 'token_hash'; tokenHash: string } | { kind: 'code'; code: string }`.
- `parseResetCredential(params: { token_hash?: string; type?: string; code?: string }): ResetCredential | null` — `token_hash` is accepted only when `type === 'recovery'`, trimmed, non-empty, at most 512 characters; otherwise `code`, trimmed, non-empty, at most 200 characters, characters `[A-Za-z0-9_-]` only; `token_hash` wins when both are present; anything else returns `null`.
- `validateNewPassword(password: string | null | undefined, confirm: string | null | undefined): string | null` — returns the existing messages: `'Password must be at least 8 characters.'` and `'Passwords do not match.'`, else `null`.
- `resetDoneVariant(role: string | undefined): 'leader' | 'member'` — `'leader'` when the role is Leader-tier or above (use `isLeaderTierOrAbove`), otherwise `'member'`. Unknown or missing role → `'member'`.

**2. `app/reset-password/confirm/page.tsx`:** keep it a Server Component, but REMOVE the Supabase call and the exchange. Read `searchParams` (`token_hash`, `type`, `code`), run `parseResetCredential`. If `null`: show the existing red box "Invalid reset link. Please request a new one." plus the "Request a new reset link" link to `/reset-password`. Otherwise render `<ResetConfirmForm tokenHash={…} code={…} />` (pass only the one that applies). Change the intro text to "Choose a new password for your account." (remove the authenticator sentence). Viewing the page must not consume the link.

**3. `app/reset-password/confirm/ResetConfirmForm.tsx`:** accept optional props `tokenHash?: string`, `code?: string`; add hidden inputs `tokenHash`, `code` (only render the one that has a value). When `state.linkInvalid` is true, show the error box and the "Request a new reset link" link in place of the form. Everything else (fields, styling, pending text) unchanged. Update the stale comment about the page establishing the session.

**4. `app/reset-password/confirm/actions.ts` `confirmPasswordResetAction`** (extend `ResetConfirmState` with `linkInvalid?: boolean`). Order matters:
1. Read `password`, `confirmPassword`, `tokenHash`, `code`. `validateNewPassword`; on error return `{ error }` — the link is NOT consumed yet.
2. `parseResetCredential({ token_hash: tokenHash, type: 'recovery', code })`; `null` → `{ error: 'Invalid reset link. Please request a new one.', linkInvalid: true }`.
3. `const supabase = await createSupabaseServerClient()`. For `token_hash`: `supabase.auth.verifyOtp({ token_hash, type: 'recovery' })`. For `code`: `supabase.auth.exchangeCodeForSession(code)`. On error → `{ error: 'Reset link is invalid or expired. Please request a new one.', linkInvalid: true }`.
4. **Always verify first; never reuse a session that already exists in the browser.** Reason: if another account is signed in in the same browser, using it would change the wrong person's password. After step 3 succeeds, `const { data: { session } } = await supabase.auth.getSession()`; none → the same invalid-link error.
5. `supabase.auth.updateUser({ password })`. On error: if the error is the "new password must differ from the old one" case (check the real code/status the installed `@supabase/auth-js` returns; do not guess), return `{ error: 'Choose a password you have not used before. Please request a new reset link.', linkInvalid: true }`; otherwise `{ error: 'Could not update password. Please request a new reset link.', linkInvalid: true }`. (The token is already used at this point, so asking for a new link is correct.)
6. Keep the existing global sign-out exactly: `createClient(NEXT_PUBLIC_SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!).auth.admin.signOut(session.access_token, 'global')`. Keep deleting cookie `fp_mfa_expires_at`.
7. Clear this browser's own cookies: `try { await supabase.auth.signOut({ scope: 'local' }) } catch {}` (the global sign-out already revoked the token; ignore any error here).
8. `const variant = resetDoneVariant(session.user.app_metadata?.role as string | undefined)`; `redirect(\`/reset-password/done?for=${variant}\`)`. Call `redirect` OUTSIDE any `try/catch` (it throws).

**5. New page `app/reset-password/done/page.tsx`** (Server Component, same card styling as the other reset pages, async `searchParams` as elsewhere in this codebase). Title "Password updated". `for=member` → "Return to the FlockPulse app and sign in with your new password." `for=leader` → "Sign in again to continue. You will be asked for your authenticator code." plus a link "Go to sign in" to `/login`. Any other or missing value → "Sign in with your new password in the FlockPulse app, or on the website." plus the `/login` link. No Supabase call, no personal data, no auth required.

**6. Tests.** New script `scripts/test-fp265-reset-flow.ts` (scripts are gitignored: `git add -f`). Part A, pure helper cases with `tsx`: valid token_hash+recovery; token_hash with wrong or missing type → falls back to code or null; both present → token_hash wins; empty, whitespace, oversize, bad characters → null; password too short / mismatch / valid; variant for ADMIN, LEADER, MEMBER, undefined, garbage. Part B, local end-to-end against the local Supabase only (call `assertLocalDb()` first, per FP-263): create a local test user, use the admin API `generateLink({ type: 'recovery', email })`, read `properties.hashed_token`, then exercise the verify → update → global sign-out sequence the way the action does, and check: the new password signs in, the old does not, a second use of the same `hashed_token` is refused, and a wrong `type` is refused. Say plainly what Part B could and could not cover (a Server Action cannot be invoked from a plain script; you are testing the Supabase calls and the helper, and you must also walk the real page in a browser against local).

**7. Local browser walk-through** (real browser against `dev:local`, local Inbucket): (a) default email link (`?code=`, same browser) works; (b) a hand-built link `/reset-password/confirm?token_hash=<hashed_token>&type=recovery` opened in a DIFFERENT browser profile works; (c) reusing it shows the friendly message; (d) opening the page without submitting does not use the link up (open it, close it, open it again, still works); (e) with account A signed in on the website in that browser, resetting account B changes B's password, not A's; (f) a Member account lands on the "Return to the FlockPulse app" text, a Leader account on the sign-in text. Report each as done or not done.

### Manual Supabase step (Joseph, NOT Claude Code — copy this into the PR description)
Do this ONLY AFTER the PR is merged and Vercel shows Ready for `dev`. The new web code accepts both the old `?code=` link and the new `?token_hash=` link, so nothing breaks in between.
1. Supabase dashboard (`fpdb-dev`) → Authentication → Email Templates → "Reset Password". Copy the current text somewhere first (so it can be restored).
2. Replace the link with: `<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery">Choose a new password</a>`. Suggested body: "Follow this link to choose a new password for your FlockPulse account. If you did not ask for this, you can ignore this email."
3. If `{{ .RedirectTo }}` is not accepted in the editor, use `{{ .SiteURL }}/reset-password/confirm?token_hash={{ .TokenHash }}&type=recovery` instead and confirm Authentication → URL Configuration "Site URL" is `https://preview.flockpulse.ca`.
4. Confirm the "Redirect URLs" list still allows `https://preview.flockpulse.ca/reset-password/confirm`.
5. Roll back by pasting the saved text back. The production Supabase project (FP-209) needs the same template edit when it is created.

### Files to Create/Modify
- Create: `src/features/auth/reset-password.ts`
- Create: `app/reset-password/done/page.tsx`
- Create: `scripts/test-fp265-reset-flow.ts` (`git add -f`)
- Modify: `app/reset-password/confirm/page.tsx`
- Modify: `app/reset-password/confirm/ResetConfirmForm.tsx`
- Modify: `app/reset-password/confirm/actions.ts`
- Must stay untouched (show `git diff dev <branch> -- <file>` with zero output): `proxy.ts`, `src/lib/site-gate.ts`, `src/lib/supabase/server.ts`, `app/reset-password/page.tsx`, `app/reset-password/ResetRequestForm.tsx`, `app/reset-password/actions.ts`, `app/login/**`, `supabase/migrations/**`.

### Migration Files (if applicable)
None.

### Branch Name
feature/FP-265-password-reset-token-link

### Commit Message
FP-265: fix password reset session, use token-in-link, member-friendly done page

### Pull Request Description
Plain GitHub markdown. Map behavior to each Acceptance Criterion on FP-265 that this DIP covers: valid link then new password succeeds and the old password stops working; other sessions are signed out; the code exchange now happens inside the Server Action that sets the password; invalid, expired or reused links show the friendly message; viewing the page does not use the link up; the link works in a different browser than the one that asked; Members see "Return to the FlockPulse app"; Leaders keep the sign-in and authenticator wording; the request page and `redirectTo` are unchanged. List deviations from this DIP with reasons. State exactly what was NOT tested: hosted `fpdb-dev` and the real emailed link, the Supabase email template change (Joseph does it after merge), real phones, and email-scanner or in-app-browser behavior. Include the "Manual Supabase step" block above verbatim, then Joseph's test steps against `preview.flockpulse.ca` after the template change: (1) request a reset on a desktop browser for a test Leader and open the email link in a different browser; (2) reuse the same link and expect the friendly message; (3) repeat with a test Member and expect the "Return to the FlockPulse app" text; (4) try signing in with the old password (must fail) and the new one (must work); (5) before editing the template, confirm an old-style link from the old template still works in the same browser.

### Jira Linkage
- PDEEpicID: FP-170
- PDEStoryID: FP-265 (web part)

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-265-web.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Branch off current dev and open the PR with gh pr create --base dev; quote the base in your report and do NOT stack it on any other branch. Do not apply any migration to a remote database (there is none) and do not merge: Joseph merges manually, then edits the Supabase email template, then tests on preview. Do not run git commands or deploy scripts in a folder Claude Code is using; wait for its report. Include full diffs for every file in your completion report per Section 5, rule 13, not a summary.
