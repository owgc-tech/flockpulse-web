### DIP 2 of 2 — Web

### Story Summary
Adds the web-side equivalent of the same self-service change-password requirement, for admin/leader users who primarily work in the web app. New section on the existing admin Profile page, calling Supabase Auth's client-side `updateUser({ password })` directly, reusing the same validation rule as mobile and registration.

### Repo Target
Web (Next.js) — new section on an existing page only, no backend/schema changes.

### Grounding Check
Confirmed live against `owgc-tech/flockpulse-web` `dev`:
- `web/app/reset-password/confirm/actions.ts` already calls `supabase.auth.updateUser({ password })` with no current-password argument — same precedent applies here as on mobile's paired DIP.
- Password complexity rule: `web/app/register/set-password/page.tsx`'s `password.length < 8` (plus `minLength={8}`) is the exact rule to reuse — not a new one.
- `app/admin/(shell)/profile/page.tsx` + `ProfileForm.tsx` (139 lines) is single-purpose (profile fields only). The new change-password UI is a sibling component, not grown into `ProfileForm.tsx`.
- The call must use the browser/client Supabase client (the caller's own session) — not the admin/service-role client this codebase uses elsewhere for managing *other* members' auth (e.g. `registration.service.ts`, `invitation.service.ts`). Confirmed those service-role `updateUserById` calls are a different code path entirely and not to be reused or confused with this one.
- No RLS/tenant-isolation invariant touched.

### Implementation Plan
1. **New `app/admin/(shell)/profile/ChangePasswordForm.tsx`** (sibling to `ProfileForm.tsx`, same directory): new password + confirm new password fields, client-side match check, `password.length < 8` validation reusing registration's exact rule, submit calls the browser Supabase client's `auth.updateUser({ password })`. Clear success and error feedback (weak password, expired session, etc.), same visual style as `ProfileForm.tsx`.
2. **`app/admin/(shell)/profile/page.tsx`**: render the new `ChangePasswordForm` as an additional section alongside the existing `ProfileForm`.

### Files to Create/Modify
- `app/admin/(shell)/profile/ChangePasswordForm.tsx` (new)
- `app/admin/(shell)/profile/page.tsx` (modify)

### Migration Files (if applicable)
None.

### Branch Name
feature/FP-186-web-self-service-change-password

### Commit Message
FP-186-web: add self-service change-password section to admin Profile page

### Pull Request Description
Maps to FP-186's web acceptance criteria: new Change Password section on the existing admin Profile page, reusing registration's existing 8-character minimum rule and calling `supabase.auth.updateUser({ password })` directly against the caller's own browser session (not the service-role client used elsewhere for managing other members' auth) — confirmed via this repo's existing `reset-password/confirm` flow that no current-password re-entry is required. Clear success/error feedback.

### Jira Linkage
- PDEEpicID: FP-170
- PDEStoryID: FP-186

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-186-web.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against dev and stop. Do not merge — the user will check out the branch locally, test it against the deployed dev environment, and merge manually.

Include full diffs for every file in your completion report per Section 5, rule 12 — not a summary.
