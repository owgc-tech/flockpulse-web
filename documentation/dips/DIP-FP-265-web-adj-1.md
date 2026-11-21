# DIP — FP-265 adj-1 (Web): password reset must work for accounts that have MFA

### Not covered — deliberately excluded
- **The mobile "Forgot password?" DIP** stays on hold until this is merged and tested on preview.
- **No MFA behavior change anywhere else.** Signing in still requires the authenticator code for every account that has MFA. Do not touch `app/login/**`, `proxy.ts`, `/admin/mfa-enroll`, or any mobile file.
- **No "ask for an authenticator code on the reset page"** (a stricter option). Joseph chose the default below; if he later wants it, it is a separate story.
- **No change to the emailed link, the request page, the done page, or the Supabase email template.** Those from PR #249 are correct and tested.
- **No migration.**

### Story Summary
PR #249 fixed the session problem, but password reset still fails for every account that has MFA enrolled (all Leaders and Admins, and any Member who set up MFA). After the emailed link is verified, `supabase.auth.updateUser({ password })` is refused by Supabase with HTTP 401, error code `insufficient_aal`: "AAL2 session is required to update email or password when MFA is enabled." A reset-link session is only at assurance level 1 (aal1), so Supabase will never allow this call for an MFA account. The user sees "Could not update password. Please request a new reset link." This was hidden before by the earlier "No active session" bug, and the local tests missed it because the local test users had no MFA factor. Fix: once the emailed link has proven control of the email address, set the new password with the service-role admin API instead of the user's own aal1 session. Signing in afterwards still requires the authenticator code, so MFA is not bypassed.

### Repo Target
Web (`owgc-tech/flockpulse-web`). No mobile change. No dependency on the other repo.

### Grounding Check
Verified in the planning session on Nov 21; **re-verify first on current `dev` (which now includes PR #249). If any claim is wrong, stop and report.**
- Evidence from `fpdb-dev` auth logs (read-only, Nov 21, 10:33 and 10:34 Toronto time): two `PUT` requests to the user-update endpoint, each answered `401`, `error_code: insufficient_aal`, error text "AAL2 session is required to update email or password when MFA is enabled." Each was preceded by a successful recovery login. Joseph's account has a verified TOTP factor.
- `app/reset-password/confirm/actions.ts` (after #249): verifies the link (`verifyOtp` for `token_hash`, or `exchangeCodeForSession` for `code`), reads `getSession()`, then calls `supabase.auth.updateUser({ password })`; any failure other than `same_password` returns "Could not update password. Please request a new reset link." with `linkInvalid: true`. Then it creates a service-role client (`createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)`) and calls `auth.admin.signOut(session.access_token, 'global')`, deletes cookie `fp_mfa_expires_at`, signs out locally, and redirects to `/reset-password/done?for=<member|leader>`.
- The local tests in `scripts/test-fp265-reset-flow.ts` used users with no MFA factor, which is why this was not caught.
- **Not verified (you must prove it locally, step 1–2):** that `supabase.auth.admin.updateUserById` has no AAL requirement, and what error code it returns for "same password" (the real `@supabase/auth-js` value; do not guess).
- Security reasoning to keep in the code comment: the link proves control of the mailbox; the new password alone does not sign anyone in, because sign-in still needs the authenticator code (aal2). All existing sessions are revoked by the existing global sign-out. The service-role client is already used in this action; keep its use to these two calls and never log the password, token or email.
- Invariants: no tenant, attendance or removal rules touched. Tenant ID not involved.

### Implementation Plan
1. **Reproduce locally first** (`supabase start`, `npm run dev:local`; FP-263 guard in force; never the hosted database). Create a local test user, then give it a verified TOTP factor by inserting a row into the LOCAL database's `auth.mfa_factors` (columns as the local schema requires; `factor_type` `totp`, `status` `verified`). Run the reset flow with the current code and confirm you get the 401 `insufficient_aal` and the "Could not update password" box. If you cannot reproduce it, stop and report.
2. **Prove the admin call works for that user:** `admin.updateUserById(userId, { password })` succeeds, the old password no longer signs in, the new password does, and sign-in then asks for MFA (aal1 → needs aal2). Record the error code returned for setting the same password.
3. **Change `confirmPasswordResetAction`** (only step 5 changes; keep steps 1–4 and 6–8 exactly):
   - Get the user id from the verified session (`session.user.id`).
   - Replace `supabase.auth.updateUser({ password })` with `svc.auth.admin.updateUserById(session.user.id, { password })`, creating `svc` once, before this step, and reusing it for the existing global sign-out.
   - Keep the same error handling: `same_password` (or the real code you found in step 2) → the existing "Choose a password you have not used before…" message; any other error → "Could not update password. Please request a new reset link." Both with `linkInvalid: true`.
   - Add a short comment explaining why the admin call is used (reset-link sessions are aal1; Supabase refuses password changes at aal1 when MFA is enabled; sign-in still needs MFA).
4. **Extend `scripts/test-fp265-reset-flow.ts` (local only, `assertLocalDb()` first):** add (a) an MFA-enrolled user (verified factor row) through the full verify → admin-update → global sign-out sequence: new password works, old refused, a second use of the link refused; (b) the same for a user with no MFA factor (must still pass); (c) the "same password" case returns the friendly error.
5. **Browser walk-through on local** for an MFA-enrolled Leader and an unenrolled Member: reset succeeds, the Leader lands on the sign-in text, the Member on "Return to the FlockPulse app". Report each as done or not done.
6. `npx tsc --noEmit` clean; eslint clean on touched files.

### Files to Create/Modify
- Modify: `app/reset-password/confirm/actions.ts`
- Modify: `scripts/test-fp265-reset-flow.ts` (`git add -f` if newly staged)
- Must stay untouched (`git diff dev <branch> -- <file>` with zero output): `proxy.ts`, `src/lib/site-gate.ts`, `src/lib/supabase/server.ts`, `app/reset-password/page.tsx`, `ResetRequestForm.tsx`, `app/reset-password/actions.ts`, `app/reset-password/confirm/page.tsx`, `ResetConfirmForm.tsx`, `app/reset-password/done/page.tsx`, `src/features/auth/reset-password.ts`, `app/login/**`, `supabase/migrations/**`, `package.json`.

### Migration Files (if applicable)
None. (The `auth.mfa_factors` insert in step 1 is for the LOCAL test database only; do not write it to a migration or to any file that ships.)

### Branch Name
feature/FP-265-adj-1-reset-mfa-accounts

### Commit Message
FP-265: set the new password with the admin API so reset works for MFA accounts

### Pull Request Description
Plain GitHub markdown. State the cause (Supabase `insufficient_aal`, 401), the evidence (auth logs), and why the local tests missed it. Map behavior: reset works for MFA and non-MFA accounts; old password stops working; all sessions signed out; sign-in still requires the authenticator code; friendly messages unchanged. List deviations with reasons. State exactly what was NOT tested (hosted `fpdb-dev` and the real emailed link; real phones). Include Joseph's steps on `preview.flockpulse.ca` after the merge and Vercel Ready: (1) request a reset for a test Leader who has MFA, open the link in a different browser, set a new password, expect the "Sign in again" text; (2) sign in with the new password and expect the authenticator code to be asked; (3) the old password must be refused; (4) repeat for a test Member; (5) reuse the same link and expect the friendly message.

### Jira Linkage
- PDEEpicID: FP-170
- PDEStoryID: FP-265 (web, adj-1)

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-265-web-adj-1.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Branch off current dev (it must include PR #249) and open the PR with gh pr create --base dev; quote the base in your report and do NOT stack it on any other branch. Do not apply any migration to a remote database (there is none) and do not merge: Joseph merges manually and tests on preview. Do not run git commands or deploy scripts in a folder Claude Code is using; wait for its report. Include full diffs for every file in your completion report per Section 5, rule 13, not a summary.
