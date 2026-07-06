# DIP-FP-102 — Web Admin Login (Email/Password + MFA, No Biometric Equivalent)

**Covers:** FP-102 (Web Admin Login)
**Epic:** FP-5 (EPIC-1 — Tenant & Access Control)

---

## Story Summary

The web Admin app currently has **no way to log in at all**. Every existing Admin page (`/admin/invite`, `/admin/invitations`) checks for a cookie named `sb-access-token` that nothing anywhere sets — confirmed directly this session, this is what caused the original 404-redirect-loop discovery. This DIP builds the real login mechanism: email/password, TOTP MFA, password-reset-interaction-with-MFA, matching the design already agreed for mobile (FP-89–93) minus any biometric/WebAuthn equivalent. **This unblocks every Admin screen already built and every one still to come in Sprint 7.**

---

## Repo Target

**Web — `owgc-tech/flockpulse-web`**, working branch `dev`.

---

## Grounding Check

1. **No local tool access this session to re-verify current file/schema state before drafting — CC must confirm everything below against the real, current codebase before implementing.** In particular: confirm the exact current content of `app/admin/invite/page.tsx` and `app/admin/invitations/page.tsx` (the `cookies().get('sb-access-token')` pattern) as they actually exist post-Sprint-6, not from this DIP's memory of them.

2. **The session mechanism must use Supabase's actual current official Next.js integration — `@supabase/ssr` + middleware — not a repeat of the ad hoc single-cookie check already sitting in the unshipped Admin pages.** This is genuinely unverified: confirm the exact current API shape (`createServerClient`, `createBrowserClient`, middleware cookie-refresh pattern) against the actually-installed package version in this repo before writing any code — do not assume from training data, same discipline as FP-54's `inviteUserByEmail`/`app_metadata` correction earlier this session, where an assumed API shape turned out to be wrong.

3. **Real open design question, not to be silently assumed either way — requires the user's direct answer before implementation, or CC must flag it back rather than guess:** the mobile design (FP-90–92) ties "new/untrusted session requires full MFA" against "trusted device gets fast biometric unlock." **Web has no trusted-device/biometric-equivalent layer at all in this pass.** Without that mechanism, does *every* web login require a fresh TOTP code, every time — or is there meant to be some other notion of a "trusted browser session" (e.g., a longer-lived session cookie that skips MFA for some period) that hasn't been specified? Do not implement either interpretation without explicit confirmation — this is a real, consequential UX decision, not a detail to infer.

4. **Real open question: is MFA enrollment mandatory at first login, or optional/skippable?** Given this surface handles real PII and was the entire reason MFA was designed in the first place (per the original board-presentation conversation earlier this session), mandatory enrollment seems the more likely intent — but this DIP does not assume it. Confirm before building the enrollment flow's gating behavior.

5. **Middleware should centralize route protection, not repeat a per-page inline check.** Every existing Admin page currently duplicates its own auth-check logic inline (`cookies().get(...)`, manual role check, `redirect('/login')` on failure). The correct architecture here is Next.js middleware protecting all `/admin/*` routes centrally — confirm this approach doesn't conflict with anything already built, and plan to simplify the two existing Admin pages to rely on the middleware rather than re-checking manually, as a cleanup within this same DIP.

6. **Password reset must invalidate the existing session and force full MFA re-verification on the next login — not silently skip it.** Same design as FP-93 (mobile). Use the same `resetPasswordForEmail()` + `updateUser({ password })` pattern already proven in FP-101/FP-55's password-setting flows, adapted for an already-registered user resetting rather than a first-time set.

7. **No WebAuthn/Passkey equivalent in this pass — confirmed explicitly, not an oversight.** Plain session persistence (Supabase's own default refresh-token behavior) is sufficient for a desktop browser context. Do not build any biometric-adjacent convenience layer.

8. **This must actually unblock the two existing Admin pages, not just exist alongside them.** After this DIP ships, `/admin/invite` and `/admin/invitations` should be updated to work correctly against the new, real session mechanism — confirm both pages actually load and function end-to-end as part of this DIP's own testing, not left as a separate follow-up.

9. **No conflicts with Section 4 invariants.** This is purely an authentication/session mechanism — no changes to tenant isolation, RBAC hierarchy, or any existing RLS policy.

---

## Implementation Plan

*(High-level — exact API calls must be verified against Grounding Check items 2–4 before finalizing; this is deliberately less prescriptive than prior DIPs given the amount of unverified API surface involved.)*

1. Install/confirm `@supabase/ssr` is available; set up `createServerClient`/`createBrowserClient` helpers per its current documented pattern.
2. Build `middleware.ts` at the project root: intercepts `/admin/*`, validates the session via the SSR client, redirects to `/login` if absent/invalid, refreshes the session cookie on each request per the standard middleware pattern.
3. Login screen (`/login`): email/password form, submits via Server Action.
4. MFA enrollment screen: TOTP QR-code generation and verification, using Supabase Auth's MFA API (exact method names to be confirmed against installed SDK — do not assume from memory).
5. MFA challenge screen: shown when a login succeeds on password but the account has MFA enrolled and the session isn't already MFA-verified (mechanism depends on resolution of Grounding Check item 3).
6. Password reset flow: request screen (email) → reset-confirmation landing page (same hash-token/`setSession()` pattern already proven in FP-55/FP-101) → new password set → session invalidated → next login requires full MFA per Grounding Check item 6.
7. Update `/admin/invite` and `/admin/invitations` to rely on middleware-protected session rather than their own inline cookie check.
8. Regression check: confirm FP-54/55/56/57's underlying flows are unaffected — this DIP only changes *how* an Admin session is established and protected, not the invitation/registration logic itself.

---

## Files to Create/Modify

- `middleware.ts` (new, project root)
- `src/lib/auth/supabase-server.ts`, `supabase-browser.ts` (new — SSR client helpers)
- `app/login/page.tsx` + supporting form component (new)
- `app/login/mfa-challenge/page.tsx` (new)
- `app/admin/mfa-enroll/page.tsx` or similar (new)
- `app/reset-password/` (new — request + confirmation pages)
- `app/admin/invite/page.tsx`, `app/admin/invitations/page.tsx` (modify — remove inline cookie check, rely on middleware)
- `documentation/test-plans/FP-102-web-admin-login-checklist.md`

---

## Branch Name

`feature/FP-102-web-admin-login`

---

## Commit Message

`FP-102: Web Admin login (email/password, TOTP MFA, no biometric equivalent)`

---

## Pull Request Description

Maps to FP-102's AC: real session establishment via `@supabase/ssr` + middleware (replacing the nonexistent `sb-access-token` cookie check), email/password login, TOTP MFA enrollment and challenge, password-reset-with-forced-MFA-reverification, no WebAuthn/biometric layer. States clearly how Grounding Check items 2–4 (SSR API shape, trusted-session semantics, mandatory-vs-optional MFA) were actually resolved, since all three were unverified/unconfirmed at drafting time.

---

## Jira Linkage

- PDEEpicID: FP-5 (EPIC-1 — Tenant & Access Control)
- PDEStoryID: FP-102

---

---

## Amendment — GC-3 and GC-4 resolutions + grounding findings (2026-07-06)

**GC-3 resolved (MFA frequency):** Per-member configurable trusted-session duration. Default 28 days; member-adjustable, hard cap 56 days. After successful TOTP verification, a `fp_mfa_expires_at` cookie is set to `now + mfa_trust_duration_days * 86400 * 1000`. The proxy reads this cookie and redirects to MFA challenge if expired, even if the Supabase session itself is still valid. Trust duration at verification time is baked into the cookie value — no DB query in the proxy.

New column: `members.mfa_trust_duration_days INTEGER NOT NULL DEFAULT 28 CHECK (mfa_trust_duration_days BETWEEN 1 AND 56)`

A settings UI (dedicated "Security" section, likely near Member Edit / FP-72) lets the member adjust this value within the 1–56 day bound.

**GC-4 resolved (MFA gating):** Mandatory, no skip. After password-only login, if the account has no verified TOTP factor (`mfa.listFactors()` returns an empty verified list), the proxy/login action redirects to enrollment. There is no way to dismiss or bypass enrollment and reach any `/admin/*` route.

**Grounding findings (confirmed pre-implementation):**

- `@supabase/ssr` was **not installed** — installed as part of this implementation (`0.12.0`). API shape: `createServerClient` with `cookies: { getAll, setAll }` (the `get/set/remove` form is deprecated). `createBrowserClient` needs no custom cookie config in normal use.
- **Next.js 16 uses `proxy.ts`, not `middleware.ts`** — `middleware` was deprecated and renamed in v16.0.0. The file convention is `proxy.ts` at the project root. Function export: `export default async function proxy(req: NextRequest)`. This is a **breaking change from every prior Next.js version** — `middleware.ts` will be silently ignored in Next.js 16.
- **Supabase MFA API** (confirmed from installed `@supabase/auth-js`): `mfa.enroll({ factorType: 'totp' })` → `{ id, totp: { qr_code, secret, uri } }`; `mfa.challengeAndVerify({ factorId, code })` → session promoted to `aal2`; `mfa.listFactors()` → factor list; `mfa.getAuthenticatorAssuranceLevel()` → `{ currentLevel, nextLevel }`.
- **Session cookie name** set by `@supabase/ssr`: `sb-<project-ref>-auth-token` (chunked). The proxy uses `createServerClient` with `req.cookies`/`res.cookies` to read/write it — not a raw `sb-access-token` string.

## Stop Point

Save this DIP verbatim to `documentation/dips/DIP-FP-102.md` and do not append executor notes after the initial save. Executor observations belong exclusively in the PR description.

**Before writing any code:** verify the actual current `@supabase/ssr` API shape against the installed package version, and **report back to the user (via Atlas) for explicit resolution of Grounding Check items 3 and 4** rather than silently choosing an interpretation — these are real product decisions, not implementation details.

**If any Jira ticket needs to be filed for a finding during this DIP, do not file it directly — report it back for Atlas to file.**

**All changes go through a feature branch and a PR — no direct pushes to `dev`, no exceptions.**

Create the feature branch, implement, test (including direct verification that `/admin/invite` and `/admin/invitations` both genuinely work end-to-end against the new session mechanism, that a password reset actually forces MFA re-verification on next login rather than silently skipping it, and that an unauthenticated request to any `/admin/*` route is correctly redirected by the middleware — not just "the page loaded when I was already logged in"), commit, push, and open the PR against `dev`. Do not merge — the user will test locally and merge manually.

Include full diffs for every file in your completion report — not a summary.
