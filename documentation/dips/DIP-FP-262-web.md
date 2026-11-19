### DIP — FP-262 (Web): neutral starter roles for new communities

### Not covered — deliberately excluded
- **Existing communities' role catalogs,** including OWGC's seven roles. They are not touched.
- **The internal role codes** (`PASTORAL_LEADER`, `COMMUNITY_SERVANT`, `SR_COORDINATOR` and so on), and the `ROLE_LABELS` fallback in `src/lib/auth/roleLabels.ts`. They are used only when a member has no catalog entry.
- **App code.** This is a migration only.
- **The production data copy (FP-209).** Its DIP must stop `AFTER INSERT ON tenants` triggers from firing when OWGC's tenant row is copied. That is noted on FP-262 and handled there, not here.

### Story Summary
Every new community currently gets OWGC's seven role names, including "Pastoral Leader", "Community Servant" and "Sr. Coordinator". Decided 2026-11-19 (Joseph): new communities start with four neutral roles instead:

| Role | Tier | Sort order |
|---|---|---|
| Member | MEMBER | 1 |
| Leader | LEADER | 2 |
| Coordinator | ADMIN | 3 |
| Admin | ADMIN | 4 |

An empty starter set is not possible: the invite form and `POST /api/invitations` need at least one role per tier.

### Repo Target
Web (`owgc-tech/flockpulse-web`), which holds the shared migrations. No mobile change.

### Grounding Check
**Verified by Atlas this session** (`origin/dev` at `f363cc1`):
- **The function** `public.create_role_catalog_for_new_tenant()` is defined only in `supabase/migrations/20260806000065_role_catalog.sql`, lines 187–204. No later migration redefines it (grep).
  - It is `LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog`.
  - It inserts 7 `(NEW.id, name, tier, sort_order)` rows and returns NEW.
- **The trigger** `trigger_create_role_catalog_for_new_tenant` is `AFTER INSERT ON tenants FOR EACH ROW`.
- **`role_catalog`** has a unique index on `(tenant_id, name)` among active rows. Confirm the exact definition.
- **`POST /api/invitations`** (`app/api/invitations/route.ts`, lines 55–59) finds a catalog entry by name, using `ROLE_LABELS[role]` ("Admin", "Leader", "Member"), and otherwise falls back to the first entry of the tier. All three names exist in the new set.
- **FP-228** (`20261004000075_api_only_data_access.sql`) revokes EXECUTE on functions from PUBLIC, anon and authenticated, and grants it to service_role.

**Re-verify all of the above.** Also confirm:
1. the next free migration number (expected `20261119000084`);
2. that no seed, test script or app code depends on a new tenant having "Pastoral Leader", "Community Servant" or "Sr. Coordinator". Check founder registration and `scripts/test-fp101-founder-registration.ts` in particular. If something does, STOP and report.

### Implementation Plan
1. **Bootstrap.** Save this DIP verbatim to `documentation/dips/DIP-FP-262-web.md`. Create `feature/FP-262-neutral-starter-roles` off current `dev`.
2. **The migration** `supabase/migrations/20261119000084_neutral_starter_roles.sql` (confirm the number):
   - `CREATE OR REPLACE FUNCTION public.create_role_catalog_for_new_tenant()` with the **same** signature, language, `SECURITY DEFINER` and `search_path`. Only the VALUES list changes, to the four rows in the table above.
   - `REVOKE EXECUTE ON FUNCTION public.create_role_catalog_for_new_tenant() FROM PUBLIC, anon, authenticated;` and `GRANT EXECUTE ... TO service_role;`. A trigger function needs no EXECUTE to fire.
   - Do not drop or recreate the trigger. Do not touch existing rows.
   - Add a header comment with the reason and FP-262.
3. **Prove only the VALUES list changed.** Extract the function body from migration 065 and from the new migration, and diff them programmatically. Paste the diff; it should show only the VALUES lines.
4. **Scratch-database test.** Run `supabase db reset` locally, then with SQL:
   - insert a new test tenant, and check that its `role_catalog` has exactly the 4 rows, names, tiers and sort orders above;
   - check that a tenant created before the migration still has its 7 rows (compare before and after);
   - apply the migration file a second time: no error, and nothing changes;
   - check privileges with `has_function_privilege` for anon, authenticated and service_role.

   Delete the test tenant afterwards. Paste the queries and results.
5. **Verification query for Joseph** (read-only, for the SQL Editor after applying), in the PR. It shows the function's current VALUES text, for example `SELECT pg_get_functiondef('public.create_role_catalog_for_new_tenant()'::regprocedure);`. Joseph confirms it lists Member, Leader, Coordinator and Admin, and nothing else.
6. **Checks.**
   - `git diff dev --stat` lists only the DIP and the migration.
   - No app code changed, so `tsc` is optional. Run it anyway and report.
7. **Commit, push, and open the PR** with `gh pr create --base dev`.

### Files to Create/Modify
- **Create:**
  - `documentation/dips/DIP-FP-262-web.md` (verbatim, then frozen);
  - `supabase/migrations/20261119000084_neutral_starter_roles.sql` (confirm the number).
- **Must stay untouched:** everything else.

### Migration Files (if applicable)
`20261119000084_neutral_starter_roles.sql`, as described above. Written to disk and validated locally only. Never apply it to the hosted database.

**Order:** it only changes what future communities get, and no code depends on it, so Joseph can apply it before or after the merge.

### Branch Name
feature/FP-262-neutral-starter-roles

### Commit Message
FP-262: give new communities neutral starter roles

### Pull Request Description
Plain GitHub markdown. Include:
- what changes and what does not (existing communities are untouched);
- the function-body diff;
- the scratch-database results;
- the verification query.

**Not tested:** the hosted database.

**Steps for Joseph:**
1. In the Supabase SQL Editor, paste and run the migration on `fpdb-dev`.
2. Run the verification query. Expected: Member, Leader, Coordinator, Admin.
3. Merge into `dev`.
4. Nothing to check in the app: OWGC is unchanged.

### Jira Linkage
- PDEEpicID: FP-170
- PDEStoryID: FP-262

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-262-web.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Branch off current dev and open the PR with gh pr create --base dev; quote the base in your report and do NOT stack it on any other branch. Do not apply any migration to a remote database and do not merge: Joseph applies migrations after review, tests, and merges manually.

Include full diffs for every file in your completion report per Section 5, rule 13, not a summary.
