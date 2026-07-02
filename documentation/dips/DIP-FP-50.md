DIP-FP-50 — Fix get_tenant_id() JWT Claim Path
Covers: FP-50 (TECH-DEBT — get_tenant_id() reads wrong JWT claim path; RLS has never functioned for any authenticated user) Epic: None (deliberately unparented — same reasoning as FP-49, schema-wide, not tied to one feature epic; parenting under EPIC-1 would silently reopen a scope decision the user made explicitly, not something to do without asking)
Story Summary
`get_tenant_id()` reads `tenant_id` from the top level of the JWT payload; Supabase Auth actually nests custom claims under `app_metadata.tenant_id`. Every RLS policy in the schema calls this function, so every one of them has evaluated `tenant_id = NULL` for every real authenticated user since the schema's first migration — denying everyone, unconditionally, on every table. This DIP fixes the function's JSON path, confirms the fix empirically using the same probe methodology that found the bug, and runs a breadth-only regression sweep across every affected table. Full scope-matrix testing (leader-assignment checks, role restrictions, the specific gap predicted in DIP-FP-49) is explicitly out of scope here — that resumes as FP-49's own follow-up once this fix is in place, since this bug's accidental fail-closed behavior is exactly what was preventing FP-49's real tests from being meaningful.
Repo Target
Web — `owgc-tech/flockpulse-web`, working branch `dev`.
Grounding Check

1. Two prior definitions of `get_tenant_id()` exist, both wrong, in different migrations. Migration `20260629000000` (original): `current_setting('request.jwt.claims', true)::json->>'tenant_id'`. Migration `20260629000002` ("Security Hardening Patch"): `(auth.jwt() ->> 'tenant_id')::UUID` — this second version is the one currently active (later `CREATE OR REPLACE` supersedes the first), and it makes the identical top-level-claim mistake, just via a different Supabase helper function. This DIP's `CREATE OR REPLACE` will supersede whichever is currently live — no need to special-case based on migration history, but both are documented here for the record since a fix touching only one would leave the other's mistake undocumented.
2. The TypeScript layer was never affected — confirm this stays true, don't touch it. `withAuth()` in `middleware.ts` reads `user.app_metadata?.tenant_id` directly from the Supabase JS client's parsed user object, which correctly exposes `app_metadata` — this has been correct all along and is why the application has worked despite this bug (service-role client bypasses RLS entirely; TypeScript-layer tenant scoping was never the affected path). Do not modify `middleware.ts` as part of this DIP — there's nothing wrong there.
3. Scope discipline: fix + confirm + breadth-check only. This DIP does not include FP-49's full test matrix (leader-assignment scope, role-restriction checks, the predicted `attendance_leader_insert` gap). Resist the temptation to just keep going into that matrix once the function is fixed and everything is "finally testable" — that's FP-49's story, with its own DIP, its own review cycle, and its own already-written prediction to check against. Mixing the two makes it harder to attribute which DIP found what.
4. `fpdb-dev` needs the same probe check, not an assumption either way. Unlike the local-only grants bug (`000011`), there's no reason to expect Supabase's hosted product behaves differently here — this is an authoring mistake in application-level SQL, not a platform default. Don't assume it's fine on remote; confirm with the same methodology.
5. No conflicts with Section 4 invariants. This restores a security control to working order; it doesn't change any business rule.
Implementation Plan

1. Migration: `CREATE OR REPLACE FUNCTION public.get_tenant_id()`, changing `auth.jwt() ->> 'tenant_id'` to `auth.jwt() -> 'app_metadata' ->> 'tenant_id'` (note the `->` for the intermediate object traversal, `->>` only on the final text extraction). Keep `RETURNS UUID`, `LANGUAGE sql`, `STABLE`, `SECURITY DEFINER`, and the existing `SET search_path` clause unchanged — only the claim-path expression changes.
2. Confirm the fix empirically, reusing the exact probe methodology that found the bug: create a real Supabase Auth user via the admin API with `app_metadata.tenant_id` set, sign in for a real JWT, call `get_tenant_id()` via RPC through an anon-key-authenticated client, confirm it now returns the correct UUID (not `NULL`). Clean up the probe user afterward.
3. Breadth-only regression sweep across every table with a `get_tenant_id()`-dependent policy: `tenants`, `members`, `groups`, `assignments`, `events`, `event_attendees`, `event_notifications`, `rsvps`, `member_attendance_reports`, `attendance`. For each, confirm a real authenticated user can now `SELECT` their own tenant's rows (where a SELECT policy exists) — this is a "does the fix unblock legitimate access at all" check, not exhaustive scope testing. One passing read per table is sufficient here; do not build out role/scope permutations — that's FP-49's job.
4. Check `fpdb-dev`: run the same probe (create user, sign in, call `get_tenant_id()` via RPC) directly against the remote project using its own anon key, to confirm whether the same bug is present there. Report the result either way — this DIP's job is to find out, not to assume.
5. Update the FP-50 Jira ticket status is not part of this DIP's scope — that's the user's action after reviewing the PR, same as every other story this session.
Files to Create/Modify

* `supabase/migrations/20260629000012_fix_get_tenant_id_claim_path.sql`
Migration File
`supabase/migrations/20260629000012_fix_get_tenant_id_claim_path.sql`

```sql
-- FP-50: get_tenant_id() read a top-level 'tenant_id' JWT claim; Supabase Auth actually
-- nests custom claims under app_metadata.tenant_id. Every RLS policy in this schema calls
-- this function, so every policy has evaluated tenant_id = NULL for every real authenticated
-- user since the schema's first migration — denying everyone, unconditionally, on every table.
--
-- Two prior wrong definitions existed:
--   20260629000000 (original):  current_setting('request.jwt.claims', true)::json->>'tenant_id'
--   20260629000002 (hardening): auth.jwt() ->> 'tenant_id'   -- currently active, same mistake
--
-- This fix corrects the JSON path to read the nested app_metadata claim. No change to the
-- TypeScript layer (src/lib/auth/middleware.ts) — it already reads app_metadata.tenant_id
-- correctly from the parsed Supabase user object; only this SQL-side function was wrong.

CREATE OR REPLACE FUNCTION public.get_tenant_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
  SELECT (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::UUID;
$$;

```

Branch Name
`feature/FP-50-fix-get-tenant-id`
Commit Message
`FP-50: Fix get_tenant_id() to read tenant_id from app_metadata, not top-level JWT claim`
Pull Request Description
Implements FP-50:

* ✅ `get_tenant_id()` now reads `app_metadata.tenant_id` correctly
* ✅ Fix confirmed empirically via the same probe methodology that found the bug — `get_tenant_id()` returns the correct UUID for a real authenticated user, not `NULL`
* ✅ Breadth regression sweep across all 10 affected tables — legitimate authenticated access confirmed working, not just the function in isolation
* ✅ `fpdb-dev` checked directly — [result to be filled in by CC: same bug present / not present]
Explicitly not included, by design:

* FP-49's full scope-matrix testing (leader-assignment checks, role restrictions, the predicted `attendance_leader_insert` gap) — that resumes as its own follow-up now that this fix removes the accidental fail-closed protection that was masking it
* No changes to `middleware.ts` or any TypeScript file — confirmed unaffected, confirmed untouched
Jira Linkage

* PDEEpicID: None (deliberately unparented)
* PDEStoryID: FP-50 (TECH-DEBT — get_tenant_id() reads wrong JWT claim path)
Stop Point
Save this DIP verbatim to `documentation/dips/DIP-FP-50.md` and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description.
Create the feature branch, apply the migration locally, run the probe confirmation, run the breadth sweep, check `fpdb-dev`, commit, push, and open the PR against `dev`.
Do not proceed into FP-49's original test matrix as part of this DIP, even though the fix makes it newly possible to do so. That is separate, subsequent work.
Open the PR against dev and stop. Do not merge — the user will check out the branch locally, test it, and merge manually.
Include full diffs for every file in your completion report per Section 5, rule 12 — not a summary.
