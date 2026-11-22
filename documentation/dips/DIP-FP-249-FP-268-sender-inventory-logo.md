Four small changes in one PR. No migration, no database, no new dependency.

SAVE FIRST: save this instruction verbatim to documentation/dips/DIP-FP-249-FP-268-sender-inventory-logo.md and never append to it afterwards.

BRANCH: feature/FP-249-FP-268-sender-inventory-logo off current origin/dev. Do NOT stack. Open the PR with gh pr create --base dev and quote the base in your report. Do not merge. Do not run git or deploy scripts for anyone else in this folder.

1. content/legal/privacy-policy.md: replace byte for byte with the file in the Legal folder (Policy 1.14). SHA-256 must be f51beda04af21928224129a0cfabc2177efd653fc800b808ef8a56003cb4f538. If the hash differs, stop and tell me.
2. content/legal/support-page.md: replace byte for byte with the file in the Legal folder (Support 1.6). SHA-256 must be dd53950d5416cd4b489508014830afe314a46f76b6aefc30e37010122a5b18ce. If the hash differs, stop and tell me.
   For both: count carriage returns at byte level (expect 0). Show diff against origin/dev (expect only the sender wording, reworded old change-log rows, and the new change-log rows). After the commit, show that `git show HEAD:content/legal/<file>` has the same hash. Do not touch terms-of-service.md or account-deletion-page.md.
3. documentation/legal/DATA-INVENTORY.md: replace item 11 with exactly:
11. **Birthdate column is gone.** FP-254 migration `20261121000091` was applied to the hosted database (fpdb-dev) on 2026-11-21, and the column no longer exists (checked live). Backups taken before it may still hold old birthdates until they are replaced; the retention of backups is outside the repo and not verified.
   Change nothing else in that file.
4. FP-268, dark-mode logo. public/flockpulse-logo.png has a transparent background, so on a dark card the dark-red lines almost vanish. In app/login/page.tsx and app/accept-terms/page.tsx only: wrap the existing <img> in <div className="mb-4 rounded-xl bg-white dark:p-3"> and remove "mb-4" from the img class, so light mode is pixel-identical (the card is already white) and dark mode shows the logo on a white block. Keep the img src, alt and other classes. Change nothing else. Do not touch app/coming-soon/page.tsx or LegalPage.tsx.

CHECKS: tsc clean; eslint (same warnings as origin/dev); scripts/test-fp249-legal-pages.ts and scripts/test-site-gate.ts pass; next build passes. Start the app locally and confirm /login and /accept-terms HTML contains the new wrapper (accept-terms needs a signed-in member; if you cannot reach it, say so). State plainly that you could not view dark mode in a browser.

ZERO DIFF vs origin/dev for: src/lib/site-gate.ts, proxy.ts, src/features/legal-pages/*, package.json, package-lock.json, content/legal/terms-of-service.md, content/legal/account-deletion-page.md, app/coming-soon/page.tsx. Show the git diff for each.

STAGING: stage only the 5 files above plus the saved DIP, by name. Never git add -A. Leave AGENTS.md and app.json uncommitted. Show git status and git diff --stat before committing.
COMMIT: "FP-249, FP-268: Privacy Policy 1.14 and Support 1.6 (support@ sender), DATA-INVENTORY item 11, dark-mode logo". Full diffs in your report (legal text lines may be cut in the screen output; the PR shows them).
PR DESCRIPTION: plain GitHub markdown. Map each change to its acceptance criterion; list deviations; state what was not tested (dark mode in a browser, a real phone, production); give Joseph the manual steps: open preview /login and /accept-terms in dark mode and check the logo is on a white block; check preview /privacy section 8 and /support step 3.
