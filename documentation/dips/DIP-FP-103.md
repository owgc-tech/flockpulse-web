# DIP-FP-103

### Story Summary
Today, `/register/complete` shows the same static "download the app" message to every registrant regardless of role. That's a dead end for Admin invitees specifically — FP-102 already gave Admins a working `/login` screen, but nothing on this confirmation screen ever points them to it. This DIP makes the screen role-aware: it reads the registrant's role off their JWT `app_metadata` right after registration completes, and Admin invitees get both the login link and the app-download message, while Leader/Member invitees see the app-download message only (unchanged from today). No backend or registration-transaction changes — this is confirmation-screen copy and conditional rendering only.

### Repo Target
**Web (Next.js)** — this is the post-registration confirmation screen in `owgc-tech/flockpulse-web`.

### Grounding Check
- No conflict with Section 4 invariants: this story touches no RSVP/self-report/attendance data, no tenant-isolation logic, and no RBAC enforcement — it's a client-side conditional render off a role already present in the JWT.
- Schema/API surface: no new tables, columns, or endpoints. The role value comes from `app_metadata.role`, the same claim FP-102's `proxy.ts` already reads for AAL/role checks — confirm the exact claim shape live against `proxy.ts` before wiring this up, don't assume the field name from memory.
- No cross-tenant, atomicity, or canonical-error-code considerations apply — no writes happen in this story.
- **Verification needed before implementation:** confirm whether the same static-copy gap exists on **both** `/register/complete` (general invite completion, FP-55) **and** `/register/founder/complete` (founder flow, FP-101), or only the former. The Jira AC covers both conditionally ("and/or... if the same gap applies there") — don't assume; check both files.

### Implementation Plan
1. Locate the actual confirmation-screen component(s) — likely `app/register/complete/page.tsx` and `app/register/founder/complete/page.tsx` (or a client component either renders) — confirm real paths before editing, do not assume from this DIP's description alone.
2. In each screen where the gap applies, read `role` from the authenticated registrant's session/JWT `app_metadata` after successful registration (same mechanism FP-102 already established — reuse it, don't re-derive a new way to read the claim).
3. Render conditionally:
   - **Admin:** show a link/button to `/login` **and** the existing "download the app" message.
   - **Leader/Member:** show the existing "download the app" message only — no login link.
4. The app-download message/link may remain a placeholder (mobile app doesn't exist yet) — no change needed there.
5. No change to `complete_registration()` or any other part of the registration-completion transaction (members/assignments/invitations writes) — confirm this DIP doesn't touch that function at all.

### Files to Create/Modify
- `app/register/complete/page.tsx` (or the actual component rendering that route — confirm real path)
- `app/register/founder/complete/page.tsx` (or equivalent — only if the same gap is confirmed to exist here)
- Any shared confirmation-screen component both routes might already share (check for one before assuming two independent implementations)

### Migration Files (if applicable)
None — no schema changes.

### Branch Name
feature/FP-103-role-aware-registration-complete

### Commit Message
FP-103: Show role-aware confirmation screen (Admin login link + app download)

### Pull Request Description
- Maps to FP-103 AC: Admin invitees see `/login` link + app-download message; Leader/Member invitees see app-download message only; no change to the registration-completion transaction itself.
- Note explicitly in the PR whether the gap existed on one or both completion routes, and which were changed.

### Jira Linkage
- PDEEpicID: FP-8 (EPIC-2 — Member & Group Management)
- PDEStoryID: FP-103

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-103.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against dev and stop. Do not merge — the user will check out the branch locally, test it, and merge manually.

Include full diffs for every file in your completion report per Section 5, rule 12 — not a summary.
