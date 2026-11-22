### DIP — FP-249 (Web): final legal text, and open the four legal pages through the "Coming soon" gate

### Not covered — deliberately excluded
- The release PR `dev` → `main`. Joseph does it after this PR is merged and checked on preview.
- `documentation/legal/DATA-INVENTORY.md` (Harvey's change note applies there). Separate docs-only DIP later.
- In-app links (FP-185), store listings (FP-210), Play Console steps.
- The invitation sender address in the Privacy Policy (waiting on a value from Joseph).
- The dark-mode logo on the login page (separate small change).
- Any edit to the legal text. Claude Code copies Harvey's files byte for byte and never rewrites them.
- No new route, no API change, no data access, no migration.

### Story Summary
The four public pages (/privacy, /terms, /support, /delete-account) are built and checked on preview, but two things keep them off flockpulse.ca. (1) The date lines in the four files still say `[TO DECIDE …]`, and by design a production build returns 404 for any page that still has one. (2) `GATE_PUBLIC_PATHS` is empty, so the site-wide "Coming soon" gate hides everything. This PR replaces the four files with Harvey's final versions (dates filled, Terms and Privacy Policy cross-linked) and opens exactly those four paths in the gate. Google Play needs a public privacy policy before the closed test starts, so the pages must be public while the rest of the site stays "Coming soon". Both changes ship together because the first alone would still give 404s.

### Repo Target
Web (Next.js), repo `owgc-tech/flockpulse-web`. No dependency on the mobile repo (the phone app already opens these pages by address).

### Grounding Check
Atlas read these this session on `dev` at `45708f1` (merge of #256). Re-verify each first and tell me if any is wrong.
- `src/lib/site-gate.ts`: `GATE_PUBLIC_PATHS: string[] = []`, with a comment saying the legal pages "join here later". `isUnder(pathname, base)` is true for an exact match or a sub-path (`base + '/'`). Asset exceptions (`/favicon.ico`, `/icon.png`, `/flockpulse-logo.png`, `/_next/static/`, `/_next/image`) already exist, so no new asset path is needed. `/api` returns `api-not-found`.
- The decision order in `siteGateDecision`: assets, then `/api`, then `/coming-soon`, then `GATE_PUBLIC_PATHS`, then `coming-soon`.
- `content/legal/*.md` on `dev` have `[TO DECIDE` only on date lines: privacy-policy.md lines 3 and 4, terms-of-service.md lines 3 and 4, support-page.md line 4, account-deletion-page.md line 4. `hasUnfinishedMarkers` runs after `stripChangeLog`, and the change logs quote markers as history.
- Tests that assume today's state and must change: `scripts/test-fp249-legal-pages.ts` (the `EXPECTED_MARKER_LINES` block, the "stripped text has unfinished markers" checks, and the last check "GATE_PUBLIC_PATHS is still empty") and `scripts/test-site-gate.ts` (the check "allowlist is empty for now"). Find them by text; line numbers may have moved.
- Database (read-only query by Atlas on fpdb-dev today): `legal_document_versions` has `terms_effective_date` and `privacy_effective_date` both 2026-11-21, so the date lines match. Do not touch the database. Because the effective dates do not change, nobody sees the acceptance screen again.
- Atlas compared Harvey's final four files with `dev`. The only changes are the date lines, the Terms and Privacy cross-links (file-name links only), the described acceptance record, the one-time-screen wording and new change-log rows. Atlas also checked the acceptance-record wording against `member_acceptances` in migration 090: member ID, community (tenant_id), the two effective dates, `confirmed_18_plus` (always true), and the time. No file contains `[TO DECIDE` or `[CHECK` above its "## Change log", none has CRLF line endings, and every `.md` link is one of the four known file names.
- SHA-256 of the four files Joseph attaches. The attachments may carry upload suffixes such as `privacy-policy__6_.md`; match them by the hash, and copy each to the plain name below. Compute your own and compare; stop and report on any mismatch:
  - privacy-policy.md (Privacy Policy 1.12): `493b5cb6ff7eb5ed8339dcf130397f828494b40ec8d5ea77fe87d8ed264de83f`
  - terms-of-service.md (Terms of Service 1.8): `f594cbe6720abf52a33d18ef8641262b589ce3586fb39b6acc62e9e95cb85431`
  - support-page.md (Support page 1.5): `1acff32ad51ea7d5f8c52cfcc563aee3a0865e56f43e714952aaa3c8307bb69a`
  - account-deletion-page.md (Account Deletion page 1.7): `7a881ab2b55a6e9cdb54acbd4a039cb78b66deaa7b8a442813c56d30e1daac37`
- Invariant rules: no attendance, RBAC, tenant, formation or removal logic is touched. No API route is added or opened. The standard error envelope is unchanged.

### Implementation Plan
0. FIRST, before anything else: save this DIP verbatim to `documentation/dips/DIP-FP-249-go-live.md`. Never append to it afterwards. Observations go in the PR description only.
1. `git fetch origin`, then branch `feature/FP-249-legal-go-live` off CURRENT `origin/dev`. Quote the `dev` commit in your report. Do not stack on any other branch.
2. Verify the four attached files (SHA-256 table above, no CRLF, no `[TO DECIDE` or `[CHECK` above the change log, date lines exactly: Privacy Policy and Terms `**Effective date:** 2026-11-21` and `**Last updated:** 2026-11-23`; Support and Account Deletion `**Last updated:** 2026-11-23`).
3. Copy each file byte for byte over `content/legal/<same name>.md`. No reformatting, no wrapping, no edits.
4. `src/lib/site-gate.ts`: set `GATE_PUBLIC_PATHS = ['/privacy', '/terms', '/support', '/delete-account']` and update the comment. Change nothing else in the file.
5. `scripts/test-site-gate.ts`: replace the empty-allowlist check. Add checks, for hosts flockpulse.ca (production and preview env), www.flockpulse.ca and flockpulse-web.vercel.app (production):
   - the four paths and a sub-path such as `/privacy/x` return `pass`;
   - these stay `coming-soon`: `/`, `/login`, `/admin`, `/register`, `/accept-terms`, `/privacy-policy`, `/privacyx`, `/terms-of-service`, `/supports`, `/delete-accounts`, `/delete`, `/Privacy`;
   - `/api/privacy` stays `api-not-found`;
   - `GATE_PUBLIC_PATHS` equals exactly the four paths;
   - `FP_PUBLIC_LAUNCH=true` still opens everything.
6. `scripts/test-fp249-legal-pages.ts`: remove the marker expectations. Assert no unfinished marker in any stripped file, that the date lines match step 2 exactly, that Terms contain `](privacy-policy.md)` (including in 1.4 and 11) and Privacy contains `](terms-of-service.md)`, and that the gate check now expects the four paths. Keep every other check. If a built-page check relied on placeholder text, adjust it only as far as needed and say so.
7. Run: `npx tsc --noEmit`, both scripts, lint (compare with `dev`, report any new warning) and `npm run build`.
8. Production-mode check, local: build and start with `VERCEL_ENV=production` (and `FP_PUBLIC_LAUNCH` unset). Request with `Host: flockpulse.ca`:
   - `/privacy`, `/terms`, `/support`, `/delete-account` return 200 and show their real dates (not 404);
   - `/`, `/login`, `/admin` and `/register` show "Coming soon";
   - `/api/anything` returns the 404 JSON envelope;
   - `/flockpulse-logo.png` returns 200.
   Also check the non-production case (no `VERCEL_ENV`, host localhost): pages still 200 and `/login` reachable. If any of this cannot run in your environment, say exactly which part was not tested.
9. Full diffs in your report. For anything that must stay untouched, show `git diff dev <branch> -- <file>` with zero output: `proxy.ts`, `src/features/legal-pages/LegalPage.tsx`, `src/features/legal-pages/legal-content.ts`, `package.json`, `package-lock.json`, `app/privacy/page.tsx`, `app/terms/page.tsx`, `app/support/page.tsx`, `app/delete-account/page.tsx`.
10. Commit with the exact message below, push the branch, open the PR with `gh pr create --base dev` and quote the base. Do not merge.

### Files to Create/Modify
- `documentation/dips/DIP-FP-249-go-live.md` (new, step 0)
- `content/legal/privacy-policy.md` (replace)
- `content/legal/terms-of-service.md` (replace)
- `content/legal/support-page.md` (replace)
- `content/legal/account-deletion-page.md` (replace)
- `src/lib/site-gate.ts`
- `scripts/test-site-gate.ts` (gitignored: force-add)
- `scripts/test-fp249-legal-pages.ts` (gitignored: force-add)

### Migration Files (if applicable)
None. Do not touch the database.

### Branch Name
feature/FP-249-legal-go-live

### Commit Message
FP-249: final legal page text and open the four legal pages through the gate

### Pull Request Description
Plain GitHub markdown, no widgets. Include:
- What changed: four files replaced with Harvey's final versions (hashes quoted), `GATE_PUBLIC_PATHS` opened for exactly four paths, two test scripts updated.
- Acceptance mapping: pages reachable without login on flockpulse.ca while the rest stays "Coming soon"; dates correct; Terms and Privacy cross-linked; no other path opened; API still refused while gated.
- Deviations from this DIP, with reasons (or "none").
- Exactly what was NOT tested (a real Vercel production deployment, a real phone, the live database).
- Manual steps for Joseph:
  1. After merge into `dev` and Vercel Ready, open preview.flockpulse.ca/privacy, /terms, /support, /delete-account. Check the dates, the logo, and click the Terms ↔ Privacy links. Preview is never gated, so this does not test the gate.
  2. Release PR `dev` → `main` with a merge commit. When Production is Ready, in a private window open flockpulse.ca/privacy (shows the policy), flockpulse.ca (still "Coming soon"), flockpulse.ca/login (still "Coming soon").

### Jira Linkage
- PDEEpicID: FP-170
- PDEStoryID: FP-249

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-249-go-live.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Branch off current dev and open the PR with gh pr create --base dev; quote the base in your report and do NOT stack it on any other branch. Do not apply any migration to a remote database and do not merge: Joseph tests and merges manually. Do not run git commands or deploy scripts in a folder Claude Code is using, and wait for its report.

Include full diffs for every file in your completion report, not a summary.
