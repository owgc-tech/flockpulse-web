**Instruction for CC — Invite email redirect bug (blocks FP-102 end-to-end testing)**

**Context:** Testing FP-102 in a deployed environment (`flockpulse-web-jwpunzalan-joseph-punzalans-projects.vercel.app`). Login, MFA enrollment, and MFA challenge all work correctly. Sending an invite (`/admin/invite`) also works — the email arrives. But clicking "Accept Invitation" in that email redirects to `localhost:3000`, which fails outside local dev. This is a bug in already-merged FP-54 invite code, not something in the FP-102 branch.

**Step 1 — Investigate and report back before changing anything.**

Find and show me the actual current code that calls `inviteUserByEmail` (or equivalent) — likely in `src/features/invitations/invitation.service.ts` or the Server Action backing `/admin/invite`. Specifically report:

1. Is a `redirectTo` option passed to `inviteUserByEmail`? If yes, paste the exact line(s) and show what value it's built from.
2. If no `redirectTo` is passed, confirm that (Supabase falls back to Auth's Site URL, which is currently `http://localhost:3000` in the Supabase dashboard).
3. Check whether an env var for the deployed site origin already exists anywhere in the repo (e.g. something like `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_APP_URL`) — grep for it. Also check `.env.local`, `.env.example`, and Vercel's configured env vars if visible, since `FounderCompleteForm.tsx` only references `NEXT_PUBLIC_SUPABASE_URL`, not a site-origin var.

Do not write any fix yet — report these three findings back first.

**Step 2 — Once findings are confirmed, the expected fix (same category as the FP-101 Vercel-preview-domain miss):**

- The invite action should pass an explicit `redirectTo` built from an environment-derived site origin, not a hardcoded string and not an unset fallback to Site URL.
- If no site-origin env var exists yet, add one (e.g. `NEXT_PUBLIC_SITE_URL`), set it in Vercel project settings to the deployed origin, and default it to `http://localhost:3000` for local dev via `.env.local`.
- `redirectTo` should point to whatever route actually completes the invitation (confirm this route from the existing invite-acceptance flow before assuming a path).

**Standing rules apply:**
- Branch off `dev`: `feature/FP-54-followup-invite-redirect` (this is a fix to FP-54, not FP-102 — keep it off the `fp102-followup` branch).
- No direct pushes to `dev`.
- Migration idempotency doesn't apply here (no schema change expected), but if you find one is needed, stop and report back before writing it.
- Do not touch the Supabase dashboard's Site URL setting yourself — that's a manual config change the user will make (Atlas separately reviewed the URL Configuration screenshot; that side is not delegated to you).
- Full diffs in your report — no summaries, no elided lines.
- If a Jira ticket is warranted for this (it may be worth tracking as a tech-debt item given FP-101 hit the same category of bug once already), do not file it yourself — report back to Atlas.

Report Step 1 findings back before proceeding to any code changes.

---

**Follow-up instruction (Step 2 go-ahead, sent after `NEXT_PUBLIC_SITE_URL` was set in Vercel):**

`NEXT_PUBLIC_SITE_URL` is now set in Vercel (Production and Preview) to `https://flockpulse-web-jwpunzalan-joseph-punzalans-projects.vercel.app`. Proceed with the fix:

1. In `sendInviteAction` (`app/admin/invite/actions.ts`) or inside `inviteMember` (your call which layer — as long as it's populated before the `inviteUserByEmail` call), pass:
   ```
   redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/register/set-password`
   ```
2. Create `.env.example` documenting `NEXT_PUBLIC_SITE_URL` (and any other required env vars already in use, if `.env.example` doesn't exist yet — confirm what's actually required by scanning existing `process.env.*` references rather than guessing).
3. Do **not** add `NEXT_PUBLIC_SITE_URL` to `.env.local` — the user has decided to skip local dev coverage for this var for now.
4. Verify `reset-password/actions.ts`'s existing `NEXT_PUBLIC_SITE_URL` usage now resolves to a real absolute URL now that the var exists — no code change expected there, just confirm.
5. Test end-to-end against the **deployed** environment: send an invite, click the email link, confirm it lands on `/register/set-password` with `type=invite` in the hash and completes registration — not just that the URL string is well-formed.

**Process, per standing rules:**
- Branch: `feature/FP-54-followup-invite-redirect`, off `dev`
- No direct pushes to `dev`
- Full diffs in your report, no summaries, no elided lines
- Open PR against `dev`, do not merge — user tests locally and merges manually
- If anything surfaces that looks like it needs a Jira ticket (tech debt, gap, etc.), report it back to Atlas rather than filing it yourself
