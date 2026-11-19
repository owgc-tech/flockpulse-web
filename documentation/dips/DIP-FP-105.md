# DIP-FP-105

### Story Summary
`FounderCompleteForm.tsx` (the founder-profile screen in the Founder Self-Registration flow, FP-101) offers five marital-status options — Single, Married, Widowed, Divorced, Separated — but `members.marital_status`'s `CHECK` constraint and `complete_registration()`'s independent revalidation both only accept `SINGLE`/`MARRIED`. Any founder picking one of the other three today gets a hard database-constraint failure and their registration never completes. Direction confirmed by the user: widen the database to accept all five UI values, rather than narrow the UI. This DIP covers only the constraint/function widening and the UI-to-DB value mapping — it deliberately does not touch `formation-completion.service.ts`'s demographic-relevance logic (`for_single_men`/`for_single_women`/`for_married_men`/`for_married_women`), since the user is still deciding how Widowed/Divorced/Separated members should be bucketed for Talk relevance. That remains a separate, explicitly deferred follow-up.

### Repo Target
Web (Next.js) — schema migration + `complete_registration()` function + `FounderCompleteForm.tsx`, all in `owgc-tech/flockpulse-web`.

### Grounding Check
- Schema verification required before writing the migration: confirm the exact current `members.marital_status` CHECK constraint name and `complete_registration()` function body directly against `supabase/migrations/20260629000020_registration_completion.sql` and the live local Supabase instance — the Jira ticket names this file and constraint from memory of the discovery session, but do not trust that description alone; read the actual current migration/function before writing the new one.
- Domain-rule conflict check (Section 4): none. This story doesn't touch RSVP, self-report, attendance, or formation invariants directly — it's a member-profile field widening. The one adjacent domain concern (formation demographic-relevance mapping) is explicitly out of scope for this DIP — see Story Summary. Flagging this boundary clearly rather than quietly expanding scope.
- Naming: no new table/endpoint created; `marital_status` stays on `members`, no new standalone fields introduced.
- Migration idempotency: constraint change must use `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT`, standard checklist item.
- No cross-tenant, atomicity, or canonical-error-code considerations — this is a single-column constraint widening plus one function's validation logic, no multi-table writes introduced.
- Important explicit non-goal for this DIP: do NOT modify `formation-completion.service.ts`. If, while implementing, it becomes obvious that leaving it unmodified creates a broken or unsafe state (e.g., a crash rather than the documented fail-open behavior), stop and flag it in the PR rather than silently fixing it — that logic change needs its own DIP once the user decides the demographic mapping.

### Implementation Plan
1. Read the actual current `members.marital_status` CHECK constraint and `complete_registration()` function body from the live migration files — confirm the exact constraint name before writing `DROP CONSTRAINT IF EXISTS`.
2. Write a new migration:
   - `DROP CONSTRAINT IF EXISTS` on the existing `marital_status` check, then `ADD CONSTRAINT` widened to `CHECK (marital_status IN ('SINGLE', 'MARRIED', 'WIDOWED', 'DIVORCED', 'SEPARATED'))`.
3. Update `complete_registration()`'s inline revalidation (`p_marital_status NOT IN (...)`) to match the same widened list — both checks must stay in sync; don't leave one stale.
4. Update `FounderCompleteForm.tsx` if it currently sends UI labels that don't map 1:1 to these DB enum values (e.g., confirm whether the form already sends `'WIDOWED'` or sends `'Widowed'` — align whichever side is wrong, don't guess).
5. Add a regression test: submit founder registration with each of the three previously-failing values (Widowed, Divorced, Separated) and confirm success; keep the existing Single/Married regression tests passing.
6. Do not touch `formation-completion.service.ts` — confirm via a quick read that it still fails open (treats the talk as relevant) for the three new values rather than erroring, and note that current behavior explicitly in the PR as the known, deliberately-unaddressed gap.

### Files to Create/Modify
- `supabase/migrations/[next-sequential-number]_widen_marital_status.sql` (new)
- The file containing `complete_registration()` (confirm actual location — likely within the registration-completion migration or a separate function-definition file; verify before editing)
- `app/register/founder/complete/FounderCompleteForm.tsx` (only if a UI-value/DB-value mismatch is found)

### Migration Files (if applicable)
Raw SQL, written to disk only, never executed live:
```sql
-- DIP-FP-105: widen members.marital_status to accept Widowed/Divorced/Separated

ALTER TABLE members DROP CONSTRAINT IF EXISTS [actual_constraint_name_confirmed_live];
ALTER TABLE members
  ADD CONSTRAINT [actual_constraint_name_confirmed_live]
  CHECK (marital_status IN ('SINGLE', 'MARRIED', 'WIDOWED', 'DIVORCED', 'SEPARATED'));
```

(CC: replace `[actual_constraint_name_confirmed_live]` with the real name found in migration `20260629000020_registration_completion.sql` — do not invent a name.)

### Branch Name
`feature/FP-105-widen-marital-status`

### Commit Message
`FP-105: Widen marital_status to accept Widowed/Divorced/Separated`

### Pull Request Description
- Maps to FP-105 AC: DB constraint and `complete_registration()` widened consistently; regression test added for the three previously-failing values.
- Explicitly notes: demographic-relevance mapping in `formation-completion.service.ts` is unchanged — still fails open for non-Single/Married values — deliberately deferred pending a separate product decision, not an oversight.

### Jira Linkage
- PDEEpicID: FP-5 (EPIC-1 — Tenant & Access Control)
- PDEStoryID: FP-105

### Stop Point
Save this DIP verbatim to `documentation/dips/DIP-FP-105.md` and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against `dev` and stop. Do not merge — the user will check out the branch locally, test it, and merge manually.
Include full diffs for every file in your completion report — not a summary.
