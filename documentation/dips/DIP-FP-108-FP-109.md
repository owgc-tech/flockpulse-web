# DIP-FP-108-FP-109

## Story Summary

Two related fixes to public-facing, unauthenticated web pages that real users hit directly from email links on their phones — bundled into one DIP because they go through the exact same manual test pass (walking both flows end-to-end on a real mobile browser), not because they share code. FP-108: password reset is completely broken — `ResetConfirmForm.tsx` only ever parses the old implicit-flow URL fragment (`#access_token=...`), but the actual reset link Supabase sends uses the newer PKCE query-param format (`?code=...`), so it fails on every single click, not just stale ones. FP-109: `/register/complete`'s form has an unconditional two-column grid with no mobile breakpoint, confirmed genuinely cramped on a phone-width screen.

## Repo Target

Web (Next.js) — owgc-tech/flockpulse-web. No mobile involvement — both are plain web pages, deliberately reachable from any browser with no app install required.

## Grounding Check

- Confirmed live: `ResetConfirmForm.tsx` reads only `window.location.hash` for `access_token`/`refresh_token`/`type=recovery`. The bug report's observed URL (`/reset-password/confirm?code=<uuid>`) is a query parameter, which this code never looks at — meaning the `if (token && refreshToken && type === 'recovery')` branch can never be entered for a real reset link, and it falls to "Invalid reset link" unconditionally. This fully explains "fails even when clicked immediately" — it was never a timing/expiry issue.
- Confirmed `confirmPasswordResetAction`'s security-critical step — `svc.auth.admin.signOut(accessToken, 'global')`, which revokes every session for the account, not just this browser's — currently depends on `accessToken` being passed in as an explicit bound argument from the client. The fix must not weaken this: once the session is established server-side instead (via `exchangeCodeForSession`), the action needs to fetch the access token from the now-existing server-side session itself (`supabase.auth.getSession()`) rather than losing this step entirely.
- Confirmed the `grid grid-cols-2 gap-4` in `CompleteProfileForm.tsx` at line 99, no responsive override.
- Verify live before writing code, don't assume: whether `/register/set-password`'s token-handling code relies on the same hash-fragment pattern as the broken `ResetConfirmForm.tsx`. If Supabase's invite/magic-link emails use a different delivery mechanism than password-reset emails within this same project, it may be entirely unaffected — but this needs confirming, not assuming, given `ResetConfirmForm.tsx`'s own comment claims they share "the same mechanism." If it turns out genuinely broken too, flag it back rather than silently expanding this DIP's scope to fix it.
- Verify live before writing code: confirm the Supabase project's Auth settings actually show Flow Type = PKCE (this is the actual root configuration source of why links come as `?code=` rather than `#access_token=`) — the code-level fix below is correct and safe regardless of what's found, but worth confirming the "why," not just patching the symptom.
- No Section 4 invariant rules touched — this doesn't change RSVP/self-report/attendance; it's authentication plumbing and a responsive-layout fix.

## Implementation Plan

FP-108:

1. `app/reset-password/confirm/page.tsx` — convert to read `searchParams` (async, per this Next.js version's convention — same `Promise<{...}>` pattern already used elsewhere in this codebase, e.g. dynamic route params). Extract `code`. If present, call `(await createSupabaseServerClient()).auth.exchangeCodeForSession(code)` server-side — this establishes the session via cookies automatically through the existing SSR client, the same one every other authenticated server action in this app already relies on.
2. If the exchange fails (expired/already-used/invalid code), render an inline error state directly from the page rather than a generic client-side "Invalid reset link" — distinguish a genuinely bad/expired link from what was actually a code bug.
3. `ResetConfirmForm.tsx` — remove the entire `window.location.hash` parsing block, the client-side `setSession()` call, and the `accessToken` state/prop-binding dance. Once the page has already established the session server-side via cookies, the form can render directly without needing to manually extract or thread a token through the client at all.
4. `confirmPasswordResetAction` — remove the explicit `accessToken` parameter from its signature (client no longer has one to pass). Inside the action, fetch it from the now-existing server-side session instead (`const { data: { session } } = await supabase.auth.getSession();`) before calling `svc.auth.admin.signOut(session.access_token, 'global')` — preserves the global-session-invalidation security behavior exactly, just sourced server-side instead of client-side.
5. Deliberately do not keep a dual-path fallback for the old hash-based flow — the fix only needs to handle the flow Supabase actually sends going forward; keeping dead code for a format that's no longer produced adds confusion, not safety.

FP-109:

6. `CompleteProfileForm.tsx` line 99 — `grid grid-cols-2 gap-4` → `grid grid-cols-1 sm:grid-cols-2 gap-4`.

## Files to Create/Modify

```
app/reset-password/confirm/page.tsx           (modified)
app/reset-password/confirm/actions.ts          (modified)
app/reset-password/confirm/ResetConfirmForm.tsx (modified)
app/register/complete/CompleteProfileForm.tsx   (modified)
```

## Migration Files

None — this is application-code-only, no schema changes.

## Branch Name

`feature/FP-108-FP-109-web-auth-pages-mobile-fixes`

## Commit Message

`FP-108-FP-109-web: fix broken password reset (PKCE code-exchange, not implicit hash) and mobile-cramped registration form`

## Pull Request Description

Maps to both stories' ACs: FP-108 — a freshly requested reset link, clicked once, now successfully lands on a working "Set new password" form (root cause: the confirm page only ever handled the old implicit-flow URL fragment, never the PKCE query-param format Supabase actually sends); submitting succeeds and the account can log in with the new password; global session invalidation on reset is preserved. FP-109 — the two-field grid on `/register/complete` now stacks to a single column on phone-width screens instead of staying forced side-by-side.

## Jira Linkage

- PDEEpicID: FP-5
- PDEStoryID: FP-108, FP-109

## Stop Point

Save this DIP verbatim to `documentation/dips/DIP-FP-108-FP-109.md`. Full implementation — commit, push, and open the PR against `dev`. Do not merge — the user reviews, merges, then tests both flows end-to-end on a real mobile browser (both iOS and Android per FP-109's own AC) before considering this done: request a real reset email, click it, set a new password, log in with it; and separately walk the full invite-acceptance flow if a fresh invite is available to test with.
