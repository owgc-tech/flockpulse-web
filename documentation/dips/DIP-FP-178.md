Story Summary
Fix the 30 pre-existing lint errors currently blocking FP-160's new "Code Quality" required CI check. These fall into five distinct categories across ~19 real application files, plus some noise from dev-only manual test scripts. Fixed properly — no blanket suppressions — so branch protection can safely require this check with enforce_admins=true as originally intended.
Repo Target
Web (owgc-tech/flockpulse-web)
Grounding Check
Verified live via npm run lint against current dev (post PR #113 merge) — not from the PR's estimated count. Actual: 30 errors, 114 warnings, 144 total problems. The five error categories and their real file locations:

@typescript-eslint/no-explicit-any (~9): event-type.repository.ts:67, formation/course.repository.ts:71, formation/module.repository.ts:75, formation/talk.repository.ts:83, groups/service.ts:22, members/service.ts:46, tasks/task.repository.ts:67, plus 4 inside scripts/test-fp60-61-64-65-67-event-admin-core-surface.ts
@next/next/no-assign-module-variable (~5): formation/module.service.ts:65, formation/talk.service.ts:30,136, plus others — a variable literally named module shadows Node's own global
React "Calling setState synchronously within an effect" (~6): spread across several app/ page/form components — needs individual review, not mechanical fixing
@next/next/no-html-link-for-pages (~3): raw <a> tags for internal nav instead of next/link's <Link>
react/no-unescaped-entities (~5): unescaped apostrophes in JSX text

No domain-rule conflicts — this is pure type-safety/lint-rule cleanup, touching repository/service layer type signatures but not behavior, except category 3 which needs care.
Implementation Plan

Decide and document /scripts/** scope first: these are one-off manual QA scripts (test-fp106-*.ts etc.), not shipped app code, and account for the bulk of the 114 warnings plus 4 of the 30 errors. Recommend excluding /scripts/** from lint scope via the ESLint config's ignores/ignorePatterns — state this decision explicitly in the PR, don't do it silently.
Category 2 (no-assign-module-variable): mechanical rename — module → something like courseModule/talkModule per file's context. Lowest risk, do first.
Category 4 (no-html-link-for-pages): swap <a href="..."> for <Link href="..."> from next/link, add the import. Mechanical, low risk.
Category 5 (no-unescaped-entities): replace raw ' in JSX text with &apos; (or restructure the string). Mechanical, zero behavioral risk.
Category 1 (no-explicit-any): replace each any with the actual inferred/expected type — check the Supabase-generated types or the function's real input/output shape rather than guessing a type. This is real type-safety work, not just satisfying the linter.
Category 3 (setState-in-effect): review each instance individually. For each, determine whether the state update belongs in an event handler instead of the effect, needs a functional setState update, or is a legitimate pattern that needs restructuring (e.g., derived state instead of an effect). Do not blanket-wrap in eslint-disable — this rule exists to catch a real class of render-cascade bugs, and mechanically silencing it could hide one.
After all fixes: confirm npm run lint shows 0 errors, npm run typecheck and npm run build both pass cleanly, and manually spot-check the pages touched by category 3's fixes still behave correctly (no visible flicker/double-render change).

Files to Create/Modify
The ~19 files identified in the Grounding Check, plus the ESLint config if /scripts/** is excluded.
Migration Files
None.
Branch Name
feature/FP-178-fix-blocking-lint-errors
Commit Message
FP-178: fix 30 pre-existing lint errors blocking Code Quality check
Pull Request Description
List each category, what was changed and why, explicit confirmation of the /scripts/** decision, and confirmation of manual spot-check results for category 3's changes.
Jira Linkage

PDEEpicID: FP-170
PDEStoryID: FP-178

Stop Point
Save verbatim to documentation/dips/DIP-FP-178.md. Open PR against dev, stop. Do not merge — test against dev Vercel deployment first, especially the category 3 pages, before merging.
