DIP-FP-53 — Revoke Erroneous anon SELECT Grant on courses/modules/talks
Covers: FP-53 (Remove erroneous anon SELECT grant on courses/modules/talks — migration `000015`) Epic: None (deliberately unparented — corrective security fix, same category as FP-49/50/51/52)
Story Summary
Migration `000015` (courses/modules/talks, merged via PR #16) contains a copy-paste error: `GRANT SELECT ON courses/modules/talks TO anon, authenticated`. Migration `000011` deliberately excludes `anon` from every table grant — "there's no endpoint that should be reachable without a JWT" — and this violates that design. The identical mistake was caught and fixed before merge in migration `000016` (FP-45). This DIP is the corrective migration for the version that already made it to `dev`.
Repo Target
Web — `owgc-tech/flockpulse-web`, working branch `dev`.
Grounding Check

1. Do not amend migration `000015` — it's already on `dev`. Same discipline as every corrective fix this session (FP-51's approach to FP-50, FP-52's approach to FP-51). A new migration only.
2. `service_role` needs no explicit grant — already covered by `000011`'s `ALTER DEFAULT PRIVILEGES`, confirmed the same way in FP-45's equivalent fix.
3. RLS is a secondary guard, not a substitute for this fix. The `SELECT` policy on all three tables (`tenant_id = get_tenant_id()`) would still filter rows even if `anon` retained table-level access — but `anon` shouldn't be able to reach the table at all, regardless of what RLS would then filter. Defense in depth means both layers correct, not one compensating for the other.
4. No conflicts with Section 4 invariants. Pure grant correction.
Implementation Plan

1. Migration: three `REVOKE SELECT ... FROM anon` statements, one per table.
2. `supabase db reset` to confirm clean apply.
3. Regression: `scripts/test-fp29-30-43-formation.ts` (17/17 expected) — confirms nothing that legitimately depends on `authenticated`/`service_role` access to these tables was affected, since only `anon` is being revoked.
Files to Create/Modify

* `supabase/migrations/20260629000018_revoke_anon_formation_grants.sql`
Migration File
`supabase/migrations/20260629000018_revoke_anon_formation_grants.sql`

```sql
-- FP-53: migration 000015 (courses/modules/talks) erroneously granted anon SELECT
-- access — copy-paste error, deviates from migration 000011's deliberate design
-- ("no endpoint should be reachable without a JWT"). The same mistake was caught
-- and fixed before merge in migration 000016 (FP-45); this is the corrective fix
-- for the version that already reached dev. Do not amend 000015 — new migration only.

REVOKE SELECT ON courses FROM anon;
REVOKE SELECT ON modules FROM anon;
REVOKE SELECT ON talks   FROM anon;

```

Branch Name
`feature/FP-53-revoke-anon-formation-grants`
Commit Message
`FP-53: Revoke erroneous anon SELECT grant on courses/modules/talks`
Pull Request Description
Maps directly to FP-53's AC: three `REVOKE` statements, `db reset` confirmed clean, formation regression suite (17/17) confirms no impact on legitimate access paths.
Jira Linkage

* PDEEpicID: None (deliberately unparented)
* PDEStoryID: FP-53 (Remove erroneous anon SELECT grant on courses/modules/talks)
Stop Point
Save this DIP verbatim to `documentation/dips/DIP-FP-53.md` and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description.
Create the feature branch, apply the migration locally, run the formation regression suite, commit, push, and open the PR against `dev`.
If any Jira ticket needs to be filed for a finding during this DIP, do not file it directly — report it back for Atlas to file.
Open the PR against dev and stop. Do not merge — the user will check out the branch locally, test it, and merge manually.
Include full diffs for every file in your completion report per Section 5, rule 12 — not a summary.
