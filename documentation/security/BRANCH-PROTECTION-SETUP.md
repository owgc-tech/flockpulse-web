# Branch Protection Setup (FP-160)

This document contains the exact commands and UI steps needed to protect the
`dev` and `main` branches on `owgc-tech/flockpulse-web`. These have **not**
been executed as part of this change — they require a repo admin (Joseph) to
run them after reviewing this PR.

## Prerequisites

- `gh` CLI installed and authenticated as a user with admin rights on the repo
  (`gh auth login`), OR access to the repo Settings UI.
- The `Code Quality` check (from `.github/workflows/ci.yml`) must have run at
  least once (e.g. on this PR) so GitHub knows about the status check name.

## Option A: `gh api` commands

Run once for `dev`, then again for `main`.

### Protect `dev`

```bash
gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  repos/owgc-tech/flockpulse-web/branches/dev/protection \
  -f "required_status_checks[strict]=true" \
  -f "required_status_checks[contexts][]=Lint, Typecheck, Build" \
  -f "enforce_admins=true" \
  -f "required_pull_request_reviews[required_approving_review_count]=1" \
  -f "required_pull_request_reviews[dismiss_stale_reviews]=true" \
  -f "restrictions=null" \
  -f "allow_force_pushes=false" \
  -f "allow_deletions=false" \
  -f "required_linear_history=false"
```

### Protect `main`

```bash
gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  repos/owgc-tech/flockpulse-web/branches/main/protection \
  -f "required_status_checks[strict]=true" \
  -f "required_status_checks[contexts][]=Lint, Typecheck, Build" \
  -f "enforce_admins=true" \
  -f "required_pull_request_reviews[required_approving_review_count]=1" \
  -f "required_pull_request_reviews[dismiss_stale_reviews]=true" \
  -f "restrictions=null" \
  -f "allow_force_pushes=false" \
  -f "allow_deletions=false" \
  -f "required_linear_history=false"
```

> Note: the status check context name (`Lint, Typecheck, Build`) must exactly
> match the job name reported to GitHub by `.github/workflows/ci.yml`
> (currently the job name is `Lint, Typecheck, Build` under the
> `Code Quality` workflow). Verify the exact context string in
> **Settings → Branches → Add rule → Status checks** or via
> `gh api repos/owgc-tech/flockpulse-web/commits/<sha>/check-runs` if the
> command above is rejected for an unrecognized context.

### Verify

```bash
gh api repos/owgc-tech/flockpulse-web/branches/dev/protection
gh api repos/owgc-tech/flockpulse-web/branches/main/protection
```

## Option B: GitHub UI steps

Repeat for both `dev` and `main`.

1. Go to **Settings → Branches** in the repo.
2. Under "Branch protection rules", click **Add rule** (or edit the existing
   rule for the branch).
3. Branch name pattern: `dev` (then repeat for `main`).
4. Enable:
   - **Require a pull request before merging**
     - Require approvals: `1`
     - Dismiss stale pull request approvals when new commits are pushed
   - **Require status checks to pass before merging**
     - Require branches to be up to date before merging
     - Search for and select the `Code Quality` check (job:
       `Lint, Typecheck, Build`) once it has run at least once
   - **Do not allow bypassing the above settings** (applies rules to admins
     too)
5. Leave **Allow force pushes** and **Allow deletions** unchecked (disabled).
6. Click **Create** / **Save changes**.

## Enabling secret scanning + push protection

This is also a UI-only step (free for public repos, no config file):

1. Go to **Settings → Code security and analysis**.
2. Enable **Secret scanning**.
3. Enable **Push protection** (blocks pushes that contain detected secrets).

## Related workflows

- `.github/workflows/codeql.yml` — CodeQL analysis on PRs to `dev`/`main` and
  weekly on a schedule.
- `.github/workflows/ci.yml` — the `Code Quality` workflow (lint, typecheck,
  build) that branch protection above gates merges on.
- `.github/dependabot.yml` — weekly npm dependency update PRs targeting both
  `dev` and `main`.
