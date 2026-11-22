# DIP — FP-249 (Web): public legal pages /privacy, /terms, /support, /delete-account

**This DIP (v2, 2026-11-21 evening) REPLACES the earlier FP-249 DIP. Use only this one. Nothing from the earlier one has been started, so there is no earlier file to keep.**

### Not covered — deliberately excluded
- **Unlocking the pages on flockpulse.ca.** `GATE_PUBLIC_PATHS` in `src/lib/site-gate.ts` stays `[]`. Preview hosts and local development are never gated, so the pages are reachable there. A tiny follow-up PR on go-live day adds the four paths to `GATE_PUBLIC_PATHS` (Joseph's decision: the pages go live the day FP-254 is deployed, once the Policy and Terms effective dates are set). Do not do it here.
- **The legal wording.** Harvey wrote it. Copy the four files byte for byte. Do not edit, shorten or "improve" any sentence.
- **In-app Privacy and Terms links** (FP-185) and the store forms. Separate stories.
- **The internal documents** (retention schedule, breach plan and log, request procedure, store answers, Harvey State). They are not published.
- **Effective and last-updated dates.** The four files still contain `[TO DECIDE: …]` placeholders. Joseph fills them on go-live day by editing the text files (one small commit). The same dates must be set in the database setting row from FP-254 (`legal_document_versions`); this DIP does not touch it.
- No migration, no database or API change, no mobile change.

### Story Summary
Google Play and Apple need public web addresses for the Privacy Policy, the Support page and the Account Deletion page, and the registration boxes added by FP-254 link to `/terms` and `/privacy`. Add four public pages that render Harvey's four text files, with the same text kept as one source of truth in the repo so a wording change is a text-file change, not a code change.

### Repo Target
Web (Next.js), `owgc-tech/flockpulse-web`. FP-254 web (PR #253) and its follow-up (PR #254) are already merged into `dev`; the registration form and the one-time screen already link to `/terms` and `/privacy` (opening in a new tab), so those two routes must exist and be public. **Requirement: all four pages are public. No login, no cookie, no API call, no redirect to /login; a person must be able to read them before they register.** Mobile (PR #162, FP-254) opens `<web host>/terms` and `<web host>/privacy` in the phone browser, so these two paths must not change.

### Grounding Check
READ on `origin/dev` at `f86bf7c` (PR #253) and PR #254 merged after it (2026-11-21). Re-verify first (`git log`, the items below); stop and report if different.
- `src/lib/site-gate.ts` has `export const GATE_PUBLIC_PATHS: string[] = [];`, with a comment "the legal pages join here later". Gated = `FP_PUBLIC_LAUNCH` not `'true'` AND (Vercel production OR host `flockpulse.ca`/`www.flockpulse.ca`); previews and local are never gated.
- `app/` has `admin`, `api`, `coming-soon`, `login`, `register`, `reset-password`, `layout.tsx` (root layout: Geist fonts, `<body className="min-h-full flex flex-col">`), `page.tsx`. No `privacy`, `terms`, `support` or `delete-account` route exists.
- `package.json` has Next 16.4.6, React 19.3.1, Tailwind 4 (`@tailwindcss/postcss`). **No markdown library and no `@tailwindcss/typography`.**
- `documentation/legal/` holds only `DATA-INVENTORY.md` (internal). Public text goes elsewhere (below).
- `proxy.ts` only protects `/admin/*` (read this session), so the four new top-level routes need no change there and are reachable without login on preview hosts.
- `src/features/legal/LegalCheckboxes.tsx` links to `/terms` and `/privacy` with `target="_blank"`; do not change it.
- The four source files (Harvey, final versions of 2026-11-21) use Markdown headings, bold, bullet and numbered lists, tables (the Privacy Policy provider table, cookie table and the change logs), blockquote-free text, and links written as `[Privacy Policy](privacy-policy.md)`, `[Terms of Service](terms-of-service.md)`, `[Delete your FlockPulse account](account-deletion-page.md)` and `mailto:` links. Each ends with `---` followed by `## Change log`, which is internal (ticket names, "effective date: the day FP-254 is deployed") and must NOT be shown publicly.
- Unfinished markers: in the TEXT ABOVE the change log each file contains only `[TO DECIDE: …]` in its date lines (Privacy Policy 2 lines, Terms 2, Support 1, Account Deletion 1) and no `[CHECK]`. The change logs themselves QUOTE the words "[TO DECIDE" and "[CHECK" as history, so the marker check MUST run on the text AFTER `stripChangeLog`, never on the whole file. Grep and report both counts.
- Rules: no secrets; the routes are public and static (no auth); no API route; no database access.

### Implementation Plan
1. **Bootstrap.** Save this DIP verbatim to `documentation/dips/DIP-FP-249-web.md`. Branch `feature/FP-249-legal-pages` off current `dev`.
2. **Source text.** Joseph provides the four files. Copy them byte for byte, with these names and no edits, into `content/legal/`: `privacy-policy.md` (v1.10), `terms-of-service.md` (v1.6), `support-page.md` (v1.4), `account-deletion-page.md` (v1.5). Joseph saves exactly these four files, under these plain names, in one folder and names it in his message. Ignore any other version or file name you may find (older copies, store answers, retention schedule, breach plan, request procedure, Harvey State, birthdate note): they are internal or superseded. Check the last row of each file's change log shows the version above; if a file is missing or the version differs, stop and ask.
3. **Dependency (one decision, default below).** Add `react-markdown` and `remark-gfm` (tables). Joseph's decision (default): accept these two packages. Before adding: run `npm view` for both, confirm the licence (MIT expected) and that the current versions support React 19 and Next 16; pin exact versions (no `^`); report versions and licences in the PR. Do not add any other package. Content is our own static files, so use no raw HTML support and no `dangerouslySetInnerHTML`. If you find a reason these two are a bad fit, stop and report instead of hand-writing a Markdown parser.
4. **Pure helpers in `src/features/legal-pages/legal-content.ts`** (no React, no Next imports):
   - `stripChangeLog(markdown)`: removes the trailing `---` plus `## Change log` section and everything after it.
   - `resolveLegalHref(href)`: maps `privacy-policy.md` to `/privacy`, `terms-of-service.md` to `/terms`, `support-page.md` to `/support`, `account-deletion-page.md` to `/delete-account`; leaves `mailto:` and `https:` links unchanged; anything else unchanged.
   - `hasUnfinishedMarkers(markdown)`: true if the text contains `[TO DECIDE` or `[CHECK`. It is called on already-stripped text.
5. **Renderer component** `src/features/legal-pages/LegalPage.tsx` (Server Component): reads the file from `content/legal/` with `fs` at build time, applies `stripChangeLog` FIRST, renders with `react-markdown` + `remark-gfm`, and maps every element (h1, h2, h3, p, ul, ol, li, table, thead, th, td, a, strong, hr, code) to Tailwind classes in the same style as the reset pages (zinc palette, `dark:` variants, readable line length `max-w-3xl`, tables scroll horizontally on a phone, links underlined). External links open in a new tab with `rel="noopener noreferrer"`; internal links use `resolveLegalHref`. **Safety rule:** if `process.env.VERCEL_ENV === 'production'` and `hasUnfinishedMarkers(stripChangeLog(markdown))` is true, return `notFound()` instead of the page, so unfinished text can never be published by accident. On preview and local, render normally (the date placeholders stay visible, which is expected).
6. **Four routes:** `app/privacy/page.tsx`, `app/terms/page.tsx`, `app/support/page.tsx`, `app/delete-account/page.tsx`, each a static page (`export const dynamic = 'force-static'`) using `LegalPage`, with `metadata` titles ("Privacy Policy | FlockPulse", "Terms of Service | FlockPulse", "Support | FlockPulse", "Delete your account | FlockPulse"). A small shared layout or wrapper may show a plain header with the text "FlockPulse" linking to `/` — keep it minimal; no navigation menus, no cookies, no scripts, no analytics.
7. **Vercel file tracing.** Reading files with `fs` must work on the deployed site, not only locally. Use a path built from `process.cwd()` and a literal folder name so Next includes `content/legal/**`; verify with a production `npx next build`, and say plainly that the deployed preview page was or was not opened (Joseph opens it after the merge).
8. **Tests:** `scripts/test-fp249-legal-pages.ts` (gitignored: `git add -f`): `stripChangeLog` on each of the four real files (the output contains no "Change log" and still ends with the contact text); `resolveLegalHref` for the four `.md` names, a `mailto:` link, an `https:` link and an unknown value; `hasUnfinishedMarkers(stripChangeLog(file))` true for each of the four current files (date placeholders) and false for a sample without markers; `hasUnfinishedMarkers` on the stripped text of each file reports exactly the date-line markers and no `[CHECK`; the page shows no `[TO DECIDE`-quoting change log text; no link in any of the four files still ends in `.md` after `resolveLegalHref`; the site gate is unchanged (`GATE_PUBLIC_PATHS` length 0; run the existing `scripts/test-site-gate.ts`). Run `npx tsc --noEmit`, `npx eslint` on changed files, all existing `scripts/test-*.ts` (must match `dev`) and `npx next build` (report route table: the four pages static). Run `next dev` locally and fetch the four routes; say what you did and did not check in a browser (dark mode, a phone-width table).

### Files to Create/Modify
- Create: `content/legal/privacy-policy.md`, `content/legal/terms-of-service.md`, `content/legal/support-page.md`, `content/legal/account-deletion-page.md`, `src/features/legal-pages/legal-content.ts`, `src/features/legal-pages/LegalPage.tsx`, `app/privacy/page.tsx`, `app/terms/page.tsx`, `app/support/page.tsx`, `app/delete-account/page.tsx`, `scripts/test-fp249-legal-pages.ts`, `documentation/dips/DIP-FP-249-web.md`.
- Modify: `package.json` and `package-lock.json` (the two packages only).
- Must stay untouched (show `git diff dev <branch> -- <file>` with zero output): `src/lib/site-gate.ts`, `proxy.ts`, `app/layout.tsx`, `app/page.tsx`, `app/coming-soon/**`, `app/login/**`, `app/register/**`, `app/reset-password/**`, `app/admin/**`, `app/api/**`, `supabase/**`.

### Migration Files (if applicable)
None.

### Branch Name
feature/FP-249-legal-pages

### Commit Message
FP-249: public legal pages (privacy, terms, support, delete account)

### Pull Request Description
Plain GitHub markdown. State: four static pages render Harvey's text files unchanged except the internal change log is not shown; links between the documents point to the real routes; the pages are not unlocked on flockpulse.ca (the gate is unchanged) and unfinished text (`[TO DECIDE`) cannot be published in production (404); packages added with exact versions and licences; deviations; what was NOT tested (deployed page, dark mode, a real phone, Vercel file tracing until the preview is opened). Manual steps for Joseph: (1) after the merge and Vercel Ready, open `preview.flockpulse.ca/privacy`, `/terms`, `/support`, `/delete-account`; (2) check the tables (providers, cookies) scroll on a phone; (3) click the links between pages and the `mailto:` links; (4) confirm no "Change log" section appears; (5) confirm `flockpulse.ca/privacy` still shows Coming soon.

### Jira Linkage
- PDEEpicID: FP-170
- PDEStoryID: FP-249

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-249-web.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Branch off current dev and open the PR with gh pr create --base dev; quote the base in your report and do NOT stack it on any other branch. No migration and no merge: Joseph merges manually. Do not run git commands in a folder Claude Code is using; wait for its report. Include full diffs for every file in your completion report per Section 5, rule 13, not a summary.
