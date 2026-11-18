### DIP — FP-241 (Web): security update — Next.js 16.4.6, Tiptap, Nodemailer 10, Supabase minors, lockfile fixes, grouped Dependabot updates

### Not covered — deliberately excluded
- **Major upgrades with their own risk.** TypeScript 7 (Dependabot `dev/typescript-7.0.2`) and ESLint 10 (`dev/eslint-10.8.1`) each get their own ticket and branch later. Joseph closes those PRs with a comment pointing to the new tickets.
- **The phone (flockpulse-mobile).** That is a separate DIP. Its advisories are almost all in build tools (Metro, the Expo command line, xmldom), not in the shipped app.
- **The remaining dev-only advisories** that sit under `eslint-config-next` (braces, micromatch, fast-glob, @next/eslint-plugin-next). npm's only "fix" is a downgrade to `eslint-config-next@14.2.35`, which is wrong for Next 16. This is lint tooling only, never shipped. Accepted and recorded in the PR.
- **Merging any Dependabot PR.** None is merged. This one PR replaces them; Joseph closes the superseded ones after this merges.
- **No application behavior change is intended.** If one turns out to be needed, stop and report.

### Story Summary
`npm audit` on `dev` (`49fe3ab`, run by Atlas on 2026-10-06) shows 42 advisories: 1 critical, 15 high, 26 moderate. The ones that matter in production:

- **Next.js 16.2.11.** Three critical remote-code-execution advisories:
  - the Image Optimization API with AVIF files (`>=16.0.0 <16.3.3`);
  - `next/og` ImageResponse (`>=16.2.0 <16.3.6`);
  - Windows-hosted servers only (`<16.3.3`; Vercel runs Linux).

  PostCSS (file disclosure, XSS) and sharp (libvips, libheif, librsvg) come in through Next. **No open Dependabot PR fixes this**: the newest one stops at 16.3.4, which is still inside the `next/og` range. The fix was 16.4.0 in October. **Since then, new critical advisories cover every version from 16.0.0 to 16.4.4**, including remote code execution through the Image Optimization API with SVG files and through `use cache` functions returning typed arrays (GHSA-2464-fhr4-w9xw, GHSA-673q-mjm6-r5xr). The fix is now **16.4.6**, the current `latest`.
- **Tiptap 3.29.2 / prosemirror-view.** A cross-site-scripting hole in paste handling, a `__proto__` attribute issue and a regular-expression denial of service. The editor is used by Admins in `app/admin/(shell)/community/RichTextEditor.tsx`. The fix is 3.31 or newer; current is 3.34.0.
- **Nodemailer 9.0.5.** Seven advisories, the worst two being denial of service through crafted address lists. Every fixed version is **10.x**, a major version whose only breaking change is "Node.js 20 or newer".
- **Lockfile-only fixes** that `npm audit fix` applies without any major change: js-yaml, brace-expansion, browserslist, nanoid, source-map-js, baseline-browser-mapping.

**Re-issue note (2026-11-17).** This DIP replaces the version Atlas wrote on 2026-10-06; that one was never sent. Atlas re-audited the planned direct dependencies against the npm registry on 2026-11-17:
- `next@16.4.0` is now flagged critical.
- `next@16.4.6` with the other versions below shows 0 production vulnerabilities.

Atlas could **not** read the repository this session, so the October numbers below are history. Redo them all.

**Atlas trial on 2026-10-06, on a scratch copy of `dev` (inference, not proof):**
- After `npm install next@16.4.0 eslint-config-next@16.4.0 @tiptap/react@^3.31.4 @tiptap/pm@^3.31.4 @tiptap/starter-kit@^3.31.4 nodemailer@^10.0.15 @supabase/supabase-js@^2.117.2 @supabase/ssr@^0.12.7`, then `npm audit fix` (no `--force`), the audit fell from 42 to **5**. All 5 are high and dev-only, under `eslint-config-next`.
- `npx tsc --noEmit` was clean, and `npm run lint` gave 0 errors and 17 warnings.
- `npm run build` could **not** be checked in Atlas's sandbox, because Google Fonts is unreachable from there. You must run it.
- Nodemailer 10's changelog lists one breaking change, Node.js 20 or newer. CI already uses Node 20. `createTransport` and `sendMail` keep their signatures, and `@types/nodemailer` 8.x still type-checks.

### Repo Target
Web (`owgc-tech/flockpulse-web`). No migration and no phone change.

### Grounding Check
Verified on web `dev` at `49fe3ab` on 2026-10-06, and NOT re-read on 2026-11-17 because Atlas had no repository access. `dev` may have moved since (FP-236 and later merges). **Re-verify every point below first, and redo the audit numbers yourself. If anything differs, report it in the PR.**

- **`package.json` today:** `next` `16.2.11` (pinned exactly), `eslint-config-next` `16.2.11` (pinned), `@tiptap/pm`, `@tiptap/react` and `@tiptap/starter-kit` `^3.29.2`, `nodemailer` `^9.0.5`, `@types/nodemailer` `^8.0.1`, `@supabase/supabase-js` `^2.108.2`, `@supabase/ssr` `^0.12.3`, `react` and `react-dom` `19.2.8`, `typescript` `^5`.
- **Nodemailer** is used only in `src/lib/email/mailer.ts`: `createTransport({ host, port, secure: false, auth })` and `sendMail({ from, to, subject, html })`.
- **Tiptap** is used only in `app/admin/(shell)/community/RichTextEditor.tsx`.
- **CI** (`.github/workflows/ci.yml`) runs `npm ci`, lint, typecheck and build on Node 20 for PRs into `dev` and `main`.
- **`.github/dependabot.yml`** has one npm entry: weekly, `target-branch: dev`, a limit of 10, and no groups.
- **Open Dependabot branches.** 17 in total, all 30 to 85 commits behind `dev`:
  - `baseline-browser-mapping`, `browserslist`, `js-yaml`, `multi-5e81c1b34f`, `dev/types/node`, `dev/types/react`, `dev/types/react-dom`: lockfile only;
  - `dev/next-16.3.1`, `multi-4b10dec7ea` (next 16.3.0), `multi-602d0ec552` (next 16.3.4), `dev/eslint-config-next-16.3.1`;
  - `dev/supabase/ssr-0.12.4`, `dev/supabase/supabase-js-2.112.3`;
  - `dev/tiptap/react-3.30.1`;
  - `nodemailer-10.0.9`;
  - `dev/typescript-7.0.2`, `dev/eslint-10.8.1`.

### Implementation Plan
1. **Bootstrap.** Save this DIP verbatim to `documentation/dips/DIP-FP-241-web.md`. Branch `feature/FP-241-web-security-updates` off current `dev`.

2. **Baseline.** On unchanged `dev`, run `npm audit --json`, `npx tsc --noEmit`, `npm run lint` and `npm run build`. Record the summaries for the PR.

3. **Update.** Change `package.json` to:
   - `next` `16.4.6` and `eslint-config-next` `16.4.6`, both **pinned exactly** as today, with no caret;
   - `@tiptap/pm`, `@tiptap/react` and `@tiptap/starter-kit`, all three the same version; use `^3.34.0`;
   - `nodemailer` `^10.6.0`;
   - `@supabase/supabase-js` `^2.119.0` and `@supabase/ssr` `^0.12.7`;
   - leave `@types/nodemailer` on 8.x, unless tsc says otherwise; say which in the PR.

   Then run `npm install` and `npm audit fix` (**never** `--force`). Do not change `react`, `react-dom`, `typescript` or `eslint` majors.

4. **Verify.**
   - Run `npx tsc --noEmit`, `npm run lint` (no new errors), and `npm run build`, which must pass.
   - Run `npm audit`. If `npm view next version` shows a newer 16.4.x than 16.4.6, stop and report before using it. Expected: no critical, and no high outside the `eslint-config-next` lint chain. List what remains with one line each.
   - Run the regression scripts on a clean `supabase db reset`: `test-fp222-adj1-what-changed.ts`, `test-fp222-indicator-flags.ts`, `test-fp236-audit-redaction.ts`, `test-fp239-event-visibility.ts`, `test-fp240-roster-visibility.ts` and `test-fp242-assignee-states.ts`. Every one must match its baseline.
   - Start `npm run dev` and load these pages as an Admin: the Events list, an event page, the Community page (rich text editor: type, bold, paste a sentence), Audit Logs, and Members. Say what you saw. You cannot test real email sending without credentials. Instead, write a small `tsx` check that `createTransport` with the same options builds a transporter and that `sendMail` exists, and say that real delivery was not tested.

5. **Dependabot grouping.** Edit `.github/dependabot.yml`: keep the existing npm entry and add `groups: { minor-and-patch: { update-types: ["minor", "patch"] } }`. Do not group majors, so each major still arrives on its own. Leave everything else unchanged. Do not add a github-actions entry; that is out of scope.

6. **Checks.** Commit, push, and run `gh pr create --base dev`.

### Files to Create/Modify
- Create: `documentation/dips/DIP-FP-241-web.md` (verbatim, then frozen).
- Modify: `package.json`, `package-lock.json`, `.github/dependabot.yml`.
- Must stay untouched: everything under `src/`, `app/`, `supabase/` and `scripts/`. Show `git diff dev feature/FP-241-web-security-updates --stat` listing only the four files above. If a source change turns out to be required, stop and report before making it.

### Migration Files (if applicable)
None.

### Branch Name
feature/FP-241-web-security-updates

### Commit Message
FP-241-web: security update to Next.js 16.4.6, Tiptap 3.34, Nodemailer 10, Supabase minors; group Dependabot minor and patch updates

### Pull Request Description
Plain GitHub markdown. Include:
- **The audit before and after**: totals by severity, plus the list of what remains and why it is accepted.
- **The version table**, old to new, for each changed direct dependency.
- **Results** of tsc, lint, build and every regression script.
- **The manual page checks** you ran.
- **The list of Dependabot PRs this supersedes**, each with its number if `gh` shows it, for Joseph to close. List TypeScript 7 and ESLint 10 separately as "close, follow-up ticket".
- **Not tested**: real email delivery, the hosted database, real browsers other than your own, and Vercel's Node version (Joseph checks: it must be 20 or newer).
- **Steps for Joseph** after merging and Vercel Ready:
  1. Log in on the web as Admin and open the Events list, an event page, Members and Audit Logs.
  2. Open Community and edit the rich text: bold, a link, a pasted paragraph, then save.
  3. Send one test invitation to your own email to confirm Nodemailer 10 sends through Mailtrap.
  4. On the phone, open the Events tab and one event. Nothing should change.

### Jira Linkage
- PDEEpicID: FP-170
- PDEStoryID: FP-241

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-241-web.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Branch off current dev and open the PR with gh pr create --base dev; quote the base in your report and do NOT stack it on any other branch. Do not apply any migration to a remote database and do not merge: Joseph applies migrations after review, tests, and merges manually.

Include full diffs for every file in your completion report per Section 5, rule 13, not a summary. The one exception is package-lock.json: report it as the list of packages whose resolved version changed (name: old → new), not the raw diff.
