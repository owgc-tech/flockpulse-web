### DIP 1 of 2 — Web

### Story Summary
Adds a real update endpoint for an existing unavailability range, closing the gap flagged during FP-190's own testing ("no edit, but it's okay for now"). Needed to support mobile's new Edit button doing a genuine atomic update rather than a risky delete-then-recreate.

### Repo Target
Web (Next.js) — single new function + route; mobile (DIP 2 of 2) consumes it.

### Grounding Check
Confirmed live against `owgc-tech/flockpulse-web` `dev`:
- `member_unavailability.repository.ts`/`.service.ts` currently only have list/create/delete — no update function exists at all, confirmed via direct read, not assumed from the DIP that shipped them.
- Existing self-service pattern (member_id derived entirely from `ctx`, never a request parameter) reused exactly, same as `deleteMyUnavailability`'s existing scoping.
- Same `VALIDATION_ERROR`/date-format validation already used in `createMyUnavailability` — reused directly, not reimplemented.

### Implementation Plan
1. **`member_unavailability.repository.ts`**: new `updateMemberUnavailabilityRange(id, memberId, tenantId, startDate, endDate)` — single `UPDATE` statement scoped by `id` + `member_id` + `tenant_id` together (same defensive triple-scoping as `deleteMemberUnavailabilityRange`), returns the updated row or `null` if no match.
2. **`member_unavailability.service.ts`**: new `updateMyUnavailability(id, memberId, tenantId, startDate, endDate)` — same `validateDate`/end-after-start validation as `createMyUnavailability`, throws `NOT_FOUND` if the repository call returns `null`.
3. **`app/api/members/me/unavailability/[id]/route.ts`**: add a `PATCH` handler alongside the existing `DELETE`, same body/error-handling shape as `POST /api/members/me/unavailability`.

### Files to Create/Modify
- `src/features/members/member_unavailability.repository.ts`, `.service.ts` (modify)
- `app/api/members/me/unavailability/[id]/route.ts` (modify)

### Migration Files (if applicable)
None — the cross-tenant trigger from FP-190-web already covers `UPDATE`, not just `INSERT` (`BEFORE INSERT OR UPDATE`), confirmed live.

### Branch Name
feature/FP-190-web-adj-2-unavailability-edit-endpoint

### Commit Message
FP-190-web-adj-2: add update endpoint for unavailability ranges

### Pull Request Description
Adds `PATCH /api/members/me/unavailability/:id` — a real, atomic update, closing the gap where editing a range required deleting and recreating it. Same self-service scoping and validation as the existing endpoints.

### Jira Linkage
- PDEEpicID: FP-11
- PDEStoryID: FP-190

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-190-web-adj-2.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against dev and stop. Do not merge — the user will check out the branch locally, test it against the deployed dev environment, and merge manually.

Include full diffs for every file in your completion report per Section 5, rule 12 — not a summary.
