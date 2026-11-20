### DIP — FP-255 (Web): removal also clears gender, marital status and the leftover login link

### Not covered — deliberately excluded
- **The mobile half** (session in the secure keychain): see **`DIP-FP-255-mobile`**. It is independent and can run in parallel.
- **Birthdate.** `remove_member()` still reduces it to January 1 of its year. FP-254 (on hold) removes birthdate entirely and will build on this DIP's version of `remove_member()`. **Never in parallel.**
- **`invitations.auth_user_id`.** It is `NOT NULL` (migration `20260629000019`) and is used to match invitations at removal. Leaving it is a known, smaller leftover; if wanted, it becomes a follow-up.
- **The FP-258 guards** (`block_last_admin_removal_or_demotion`, `member_removal_blockers`) and the existing removal triggers: unchanged.
- **Reports, forms and the app's handling of active members:** unchanged. Gender and marital status stay **required** for active members.

### Story Summary
Decided 2026-11-18 (Joseph, Harvey decision #10): removing a member, for any reason, also clears their **gender** and **marital status**. In a small community those two fields are the main way a removed person could still be recognized. This supersedes the FP-235/FP-237 rule "gender and marital status kept".

Also from the FP-248 data inventory: the anonymous member shell still holds the old login id (`members.user_id`) after the login is deleted. That link is cleared **after** the login is deleted, so a failed login deletion can still be retried. A one-time cleanup fixes members removed earlier, previewed first.

### Repo Target
Web (`owgc-tech/flockpulse-web`): one migration, one cleanup script that Joseph runs after a preview, and the members service. No mobile dependency.

### Grounding Check
**Verified by Atlas this session** (`origin/dev` at `e851503`):
- **Columns and constraints:**
  - `members.user_id UUID UNIQUE NOT NULL` (`20260629000000_create_tenants_and_members.sql` line 12);
  - `members.gender`: `CHECK (gender IN ('MALE','FEMALE'))`, and `SET NOT NULL` in `20260629000020` line 24;
  - `members.marital_status`: `SET NOT NULL` in `20260629000020` line 25, with the CHECK widened in `20260708000027` to SINGLE, MARRIED, WIDOWED, DIVORCED or SEPARATED.

  The CHECK lists already allow NULL. Only the NOT NULL constraints block clearing.
- **`remove_member(p_tenant_id, p_member_id, p_reason)`:** the latest definition is in `20261006000083` (lines 246–341). FP-258 did not change it.
  - The normal path does ONE `UPDATE members SET deleted_at, email (placeholder), first_name, last_name, birthdate` so that the guard and prune triggers fire.
  - The `ELSIF v_email <> v_placeholder` path finishes the scrub for rows removed earlier.
  - It returns `v_user_id`, read before any change. It also scrubs invitations by `auth_user_id = v_user_id` or the original email, detaches assignments, deletes unavailability and `event_member_views`, and calls `redact_removed_member_personal_text()`.
- **`src/features/members/service.ts` `removeMember()`:**
  - runs the `member_removal_blockers` pre-check (FP-258), then `rpc('remove_member')`;
  - if a user id comes back, calls `auth.admin.deleteUser(userId)`, treating 404 or `user_not_found` as success;
  - on another error, throws `AUTH_DELETE_FAILED`. The admin form tells the admin to press Remove again, which retries using the `user_id` still on the row.
- **`src/lib/auth/middleware.ts:121`:** finds the caller's member with `.eq('user_id', user.id)`. A NULL `user_id` can never match, which is correct.
- **Readers of gender and marital status:**
  - formation targeting in `src/features/formation/formation-completion.service.ts` lines 49–57 fails open on null (includes every session);
  - forms and profile read them for **active** members only.
  - No report groups by them (grep of `src/features/reports`). Confirm.

**Re-verify all of the above first.** Also:
1. confirm the **exact names** of the NOT NULL and UNIQUE constraints on `members`;
2. confirm whether any TypeScript type, query or test assumes `user_id`, `gender` or `marital_status` are always non-null **for removed members** (for example audit, member list or export);
3. confirm the next free migration number (expected `20261120000087`).

**Rules check:**
- Invariant rule 5 changes: "gender and marital status **cleared**". Atlas records this in the next manifest.
- `remove_member()` stays a single `SECURITY DEFINER` function, with service-role grants only.
- The new helper function is closed to PUBLIC, anon and authenticated (FP-228).
- No ids or personal details in messages or logs.

### Implementation Plan
1. **Bootstrap.** Save this DIP verbatim to `documentation/dips/DIP-FP-255-web.md`. Create `feature/FP-255-removal-clears-demographics` off current `dev`. Report the three grounding answers before writing code.

2. **Migration** `supabase/migrations/20261120000087_removal_clears_demographics_and_login_link.sql` (confirm the number), idempotent:
   - **Constraints:** active members keep needing these values; removed members may have NULL.
     - `ALTER TABLE members ALTER COLUMN gender DROP NOT NULL;`, then add `CHECK (gender IS NOT NULL OR deleted_at IS NOT NULL)` named `members_gender_required_when_active`.
     - The same for `marital_status`, as `members_marital_status_required_when_active`.
     - The same for `user_id`, as `members_user_id_required_when_active`. Keep the UNIQUE constraint; it allows several NULLs.
     - Use `DROP CONSTRAINT IF EXISTS` before each `ADD CONSTRAINT`, and add them `NOT VALID`, then `VALIDATE CONSTRAINT`, so an existing bad row is reported clearly.
   - **`remove_member()`:** `CREATE OR REPLACE` of the **current** definition (083), changed **only** so that:
     - the normal-path UPDATE also sets `gender = NULL, marital_status = NULL`;
     - the `ELSIF` (finish-the-scrub) UPDATE also sets `gender = NULL, marital_status = NULL`.

     Do **not** null `user_id` here: `removeMember()` needs the returned id to delete the login, and a retry needs it if that fails. Keep the same signature, return value, `SECURITY DEFINER`, `search_path` and grants.
   - **New function** `public.clear_removed_member_login_link(p_tenant_id UUID, p_member_id UUID) RETURNS void`, `SECURITY DEFINER`, `SET search_path = public, pg_catalog`:
     - `UPDATE members SET user_id = NULL WHERE id = p_member_id AND tenant_id = p_tenant_id AND deleted_at IS NOT NULL;`
     - Revoke from PUBLIC, anon and authenticated; grant to `service_role`.
   - Header comment: FP-255, the reason, the supersession of FP-235's "kept" rule, and the note that FP-254 must build on this definition.

3. **Prove only the intended lines changed.** Extract the `remove_member()` body from `20261006000083` and from the new migration, and diff them programmatically. Paste the diff; it should show only the added `gender = NULL, marital_status = NULL` in the two UPDATEs, plus the header.

4. **Service** (`members/service.ts` `removeMember()`). After `auth.admin.deleteUser(userId)` **succeeds**, or returns 404 / `user_not_found`, call `rpc('clear_removed_member_login_link', …)`.
   - If that call fails, throw a distinct error `LOGIN_LINK_CLEAR_FAILED`. The login is already gone, so the routes treat it like `AUTH_DELETE_FAILED`: a 500 with a plain message, after which pressing Remove again finishes it.
   - Order: `remove_member` → `deleteUser` → clear the link. On `AUTH_DELETE_FAILED` the link is **not** cleared, so a retry still finds the login.
   - Update the routes' error mapping minimally. Keep the existing behavior for every other error.

5. **One-time cleanup for members removed earlier** (Joseph runs it by hand, after a preview: rule 19). File: `documentation/sql/FP-255-cleanup.sql`. It is **not** a migration, and is force-added if the folder is ignored. Three sections, each clearly labelled:
   - **A. Preview (read-only).** For removed members (`deleted_at IS NOT NULL`):
     - the count with gender or marital status still set;
     - the count with a `user_id` whose login no longer exists (`NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = m.user_id)`);
     - the count with a `user_id` whose login **still exists** (a stray login).

     Counts only, grouped by tenant **name**. No member names or ids.
   - **B. Cleanup (idempotent):**
     - `UPDATE members SET gender = NULL, marital_status = NULL WHERE deleted_at IS NOT NULL AND (gender IS NOT NULL OR marital_status IS NOT NULL);`
     - `UPDATE members m SET user_id = NULL WHERE m.deleted_at IS NOT NULL AND m.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = m.user_id);`

     Removed members whose login still exists are **left alone**; pressing Remove again on them completes it.
   - **C. Verify:** rerun A. The first two counts should be 0.

6. **Scratch-database test** (`supabase db reset` locally):
   - **Plant:**
     - active members in two tenants, with gender and marital status;
     - a member removed earlier by the old routine, still holding gender, marital status and a `user_id`, with no login (its auth row deleted);
     - a removed member whose login still exists;
     - a member who leads someone (blocked);
     - the FP-237 / FP-234 prune case (a member with current task answers).
   - **Show:**
     - `remove_member` on an ordinary member: gender and marital status are NULL, `user_id` is still set, and the function returns it. After `clear_removed_member_login_link`, `user_id` is NULL;
     - the blocked member is still refused, and nothing changes;
     - the prune trigger still clears current task answers and keeps their history;
     - an **active** member cannot be saved with NULL gender, marital status or `user_id` (the CHECKs refuse it), while a removed one can;
     - the cleanup script: A shows the planted counts, B fixes only removed rows (other tenants' active rows are untouched, the stray-login row keeps its `user_id`), C shows 0 and 0, and running B twice changes nothing;
     - privileges: anon and authenticated cannot execute the new function.

   Paste the queries and results.

7. **Test script** `scripts/test-fp255-removal-clears.ts`, force-added, calling `assertLocalDb()` first (FP-263):
   - drive `removeMember()` end to end on the local database for one member;
   - check that gender, marital status and `user_id` end up NULL, and that the login is deleted;
   - simulate `deleteUser` failing (inject or mock) and check that `user_id` is kept and a second `removeMember()` call completes it.

   Run the existing removal and member scripts too (`test-fp69-72`, `test-fp73-74`, `test-fp258-removal-blockers`), and report anything that also fails on `dev`.

8. **Checks.** Run `npx tsc --noEmit`, lint, `npm run build` and the scripts. Run `git diff dev --stat`. Use `npm run dev:local` only if you need a server, and never `.env.local` (`CLAUDE.md`).

9. **Commit, push, and open the PR** with `gh pr create --base dev`.

### Files to Create/Modify
- **Create:**
  - `documentation/dips/DIP-FP-255-web.md` (verbatim, then frozen);
  - `supabase/migrations/20261120000087_removal_clears_demographics_and_login_link.sql`;
  - `documentation/sql/FP-255-cleanup.sql`;
  - `scripts/test-fp255-removal-clears.ts`.
- **Modify:**
  - `src/features/members/service.ts`;
  - `app/api/members/route.ts` and `app/api/members/me/route.ts` (error mapping only, if needed);
  - any type that wrongly assumes non-null for removed members (report each).
- **Must stay untouched:** the FP-258 migration and functions, `proxy.ts`, `src/lib/site-gate.ts`, `src/lib/auth/`.

### Migration Files (if applicable)
`20261120000087_removal_clears_demographics_and_login_link.sql`, as above. Validated locally only; never applied remotely by Claude Code.

**Order: Joseph applies the migration BEFORE merging,** because the new code calls `clear_removed_member_login_link`. Then he runs the cleanup script (preview first) at any time after the migration.

### Branch Name
feature/FP-255-removal-clears-demographics

### Commit Message
FP-255: clear gender, marital status and the login link when a member is removed

### Pull Request Description
Plain GitHub markdown. **Start with: "Apply the migration before merging. The cleanup script is separate: preview first."** Then include:
- how each acceptance criterion is met;
- the `remove_member()` diff;
- the constraint names;
- the scratch-database results;
- every place that reads gender or marital status, and why NULL is safe there;
- deviations from this DIP.

**Not tested:** the hosted database, and the browser (the admin pages are behind MFA).

**Steps for Joseph:**
1. Apply the migration in the SQL Editor on `fpdb-dev`.
2. Run **section A** of `FP-255-cleanup.sql` and send Atlas the counts.
3. After Atlas confirms, run **B**, then **C**.
4. Merge into `dev`, and wait for Vercel to show Ready.
5. Remove a **test** member on the web. Then check in the SQL Editor, read-only:
   ```sql
   SELECT gender, marital_status, user_id IS NULL AS login_link_cleared
   FROM members
   WHERE first_name = 'Deactivated' AND deleted_at > now() - interval '1 hour';
   ```
   Expected: NULL, NULL, true.

### Jira Linkage
- PDEEpicID: FP-170
- PDEStoryID: FP-255

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-255-web.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Branch off current dev and open the PR with gh pr create --base dev; quote the base in your report and do NOT stack it on any other branch. Do not apply any migration to a remote database and do not merge: Joseph applies migrations after review, tests, and merges manually.

Include full diffs for every file in your completion report per Section 5, rule 13, not a summary.
