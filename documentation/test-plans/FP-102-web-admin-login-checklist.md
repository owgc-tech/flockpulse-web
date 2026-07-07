# FP-102 — Web Admin Login: Test Plan Checklist

**Branch:** `feature/fp102-web-admin-login`
**PR:** #32

---

## Automated Tests (run `npx ts-node --project tsconfig.json scripts/test-fp102-web-admin-login.ts`)

### Group 1 — `mfa_trust_duration_days` DB Constraint

- [ ] 1.1 — Column exists on `members` with DEFAULT 28
- [ ] 1.2 — INSERT without specifying column receives DEFAULT 28
- [ ] 1.3 — UPDATE to 56 (maximum) succeeds
- [ ] 1.4 — UPDATE to 57 (above maximum) is rejected by CHECK constraint
- [ ] 1.5 — UPDATE to 1 (minimum) succeeds
- [ ] 1.6 — UPDATE to 0 (below minimum) is rejected by CHECK constraint

### Group 2 — MFA API

- [ ] 2.1 — `mfa.listFactors()` returns no verified factors before enrollment
- [ ] 2.2 — `mfa.enroll()` returns a factor ID and QR code SVG
- [ ] 2.3 — `mfa.listFactors()` succeeds after enroll (unverified factors may not be listed)
- [ ] 2.4 — `mfa.challengeAndVerify()` with wrong code is rejected
- [ ] 2.5 — `mfa.challengeAndVerify()` with correct TOTP code returns a JWT with `aal` = `aal2`
- [ ] 2.6 — `mfa.listFactors()` shows the factor as `verified` after `challengeAndVerify`
- [ ] 2.7 — `mfa.unenroll()` removes the factor

---

## Manual — Login Flow (Golden Path)

- [ ] `/login` renders email/password form
- [ ] Submitting valid credentials for an ADMIN account (with no enrolled MFA) redirects to `/admin/mfa-enroll`
- [ ] Submitting valid credentials for an ADMIN account (with enrolled + verified MFA) redirects to `/login/mfa-challenge`
- [ ] Submitting invalid credentials shows an error; no redirect
- [ ] Submitting credentials for a non-ADMIN account shows an error ("Unauthorised")

## Manual — MFA Enrollment (`/admin/mfa-enroll`)

- [ ] Page renders a QR code and a text entry field
- [ ] Submitting the wrong TOTP code shows an error; does not redirect
- [ ] Submitting the correct TOTP code redirects to `/admin/invitations`
- [ ] `fp_mfa_expires_at` cookie is set after successful verification
- [ ] `fp_mfa_expires_at` value is approximately `now + mfa_trust_duration_days * 86400 * 1000`

## Manual — MFA Challenge (`/login/mfa-challenge`)

- [ ] Page renders a TOTP entry field
- [ ] Submitting the wrong code shows an error; no redirect
- [ ] Submitting the correct code redirects to `/admin/invitations` (or `?next=` param if set)
- [ ] `fp_mfa_expires_at` cookie is set after successful verification

## Manual — Proxy Protection (`proxy.ts`)

- [ ] Direct navigation to `/admin/invitations` while unauthenticated redirects to `/login`
- [ ] Direct navigation to `/admin/invite` while unauthenticated redirects to `/login`
- [ ] Direct navigation to `/admin/*` as a non-ADMIN user redirects to `/login`
- [ ] Direct navigation to `/admin/*` as an authenticated ADMIN without `fp_mfa_expires_at` cookie redirects to `/login/mfa-challenge`
- [ ] Direct navigation to `/admin/*` as an authenticated ADMIN with an expired `fp_mfa_expires_at` cookie redirects to `/login/mfa-challenge`
- [ ] Direct navigation to `/admin/*` as an authenticated ADMIN with a valid `fp_mfa_expires_at` and an AAL2 session loads the page

## Manual — Password Reset

- [ ] `/reset-password` renders an email entry form
- [ ] Submitting a valid email sends a reset email (visible in Mailpit at `http://127.0.0.1:54324`)
- [ ] Clicking the reset link lands on `/reset-password/confirm` with a valid session
- [ ] Submitting mismatched passwords shows an error
- [ ] Submitting a valid new password:
  - [ ] Redirects to `/login`
  - [ ] `fp_mfa_expires_at` cookie is cleared
  - [ ] All existing sessions for the account are invalidated (test by opening a second browser with a valid session — it should be kicked out on next request)
- [ ] Logging back in with the new password requires full MFA challenge (no trust window)

## Manual — Regression (FP-54/56/57)

- [ ] `/admin/invite` page loads correctly after the `@supabase/ssr` migration (no `sb-access-token` cookie usage)
- [ ] Sending an invitation from `/admin/invite` works end-to-end
- [ ] `/admin/invitations` lists existing invitations correctly
- [ ] Cancelling/resending an invitation from `/admin/invitations` works end-to-end
