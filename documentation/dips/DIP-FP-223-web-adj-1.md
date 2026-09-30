### DIP — FP-223-adj-1 (Web) — Exclude drafts from mobile's Events list

### Story Summary
Excludes DRAFT-status events from the widened Admin/Leader-owner visibility added in FP-223. Confirmed with Joseph: drafts should only be visible in web admin, never in the mobile Events tab, regardless of role.

### Repo Target
Web (Next.js) — single file, one additional filter condition.

### Grounding Check
Confirmed live against `owgc-tech/flockpulse-web` `dev` (post-FP-223 merge): the Member-only path already naturally excludes drafts (no `event_attendees` row exists for an unpublished event), but the new Admin (`seesAll`) and Leader-owner (`seesOwned`) paths bypass that gate entirely, since they query `events` directly — meaning drafts currently leak through for those two roles specifically.

### Implementation Plan
1. In `listEventsForMember()`, add `.neq('status', 'DRAFT')` alongside the existing `.neq('status', 'CANCELLED')` condition in the `seesAll || seesOwned` branch.
2. No other change — the Member path is already correct and untouched.

### Files to Create/Modify
- `src/features/events/service.ts` (modify)

### Branch Name
feature/FP-223-web-adj-1-exclude-drafts-mobile

### Commit Message
FP-223-web-adj-1: exclude DRAFT events from widened mobile visibility

### Pull Request Description
Maps to Joseph's follow-up: drafts stay visible in web admin only, never in mobile's Events tab, for any role. Confirm in the PR that a draft event you own no longer appears in your own mobile list after this change, while a scheduled one still does.

### Jira Linkage
- PDEEpicID: FP-31
- PDEStoryID: FP-223

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-223-web-adj-1.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against feature/FP-223-web-owner-admin-event-visibility (stacked — that PR is still open) and stop. Do not merge — the user will check out the branch locally, test it, and merge manually.

Include full diffs for every file in your completion report per Section 5, rule 12 — not a summary.
