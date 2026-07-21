DIP 1 — flockpulse-web
Story Summary
Add CodeQL code scanning, Dependabot, and branch protection to flockpulse-web. Since the repo is public, CodeQL and secret scanning are free GitHub features — this just needs enabling, not a paid tier.
Repo Target
Web (owgc-tech/flockpulse-web)
Grounding Check
Confirmed FP-160's Jira description live. No conflicting CI config assumed — CC must check for existing .github/workflows/ files first and report if anything already there needs to coexist with or be replaced by this. No schema/domain-rule concerns — pure repo tooling.
Implementation Plan

Check .github/workflows/ for any existing CI config; report findings before proceeding.
Create .github/workflows/codeql.yml using github/codeql-action for JavaScript/TypeScript, triggered on PRs to dev/main and on a weekly schedule.
Create .github/workflows/ci.yml (Code Quality): npm ci, lint, typecheck, npm run build on every PR — this is the required status check branch protection will gate on.
Create .github/dependabot.yml: npm ecosystem, weekly schedule, both dev and main as target branches.
Enable secret scanning + push protection via repo settings (Settings → Code security and analysis) — free on public repos; note in the PR description that this still needs a human click in GitHub's UI, it's not committable config.
Write documentation/security/BRANCH-PROTECTION-SETUP.md containing the exact gh api commands (or step-by-step UI instructions) to protect dev and main: require PR review before merge, require the Code Quality check to pass, disallow direct pushes/force-pushes. Do not execute these commands yourself.
npm run build must still pass cleanly for the CI workflow's own correctness before opening the PR.

Files to Create/Modify

.github/workflows/codeql.yml
.github/workflows/ci.yml
.github/dependabot.yml
documentation/security/BRANCH-PROTECTION-SETUP.md

Branch Name
feature/FP-160-web-ci-security-tooling
Commit Message
FP-160: add CodeQL, Dependabot, and branch protection setup guide (web)
Pull Request Description
Map to FP-160's scope items for web: Code Quality workflow, Dependabot, secret scanning enablement note, branch protection commands documented (not executed).
Jira Linkage
PDEEpicID: FP-5 · PDEStoryID: FP-160
Stop Point
Save verbatim to documentation/dips/DIP-FP-160-web.md. Open PR against dev, stop. Do not run the branch protection commands from step 6 — those are for Joseph to execute after reviewing. Do not merge.
