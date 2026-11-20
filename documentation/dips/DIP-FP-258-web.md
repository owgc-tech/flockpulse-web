### DIP — FP-258 (Web): protect the last Administrator, and list every removal block in plain words

### Not covered — deliberately excluded
- **The mobile app.** It has its own DIP, `DIP-FP-258-mobile`, which is sent after this one is merged and deployed. The current phone app keeps working: it already turns the count fields into friendly sentences, and it will show this DIP's plain `message` for the new last-Admin case.
- **`remove_member()` itself.** It is **not modified.** The last-Admin rule is a new trigger, which avoids any conflict with FP-254, FP-255 and FP-257, the tickets that will change `remove_member()`.
- **Changing what blocks removal.** The three existing guards (leads active members, owns active groups, owns upcoming events) keep their exact conditions.
- **A "close the community" feature.** People are told to email support.

### Story Summary
Two gaps in account removal (in-app "Delete My Account" and the admin "Remove") were found on 2026-11-18:
1. **The last Administrator of a community can remove themselves,** which leaves nobody who can manage it. The Privacy Policy (1.4), Terms (1.2) and Account Deletion page (1.3) already promise that this can't happen, so it must be enforced in the database.
2. **When removal is blocked, only the first reason is reported, and the API `message` is the raw database text** (with the member's internal id). This DIP checks every reason up front, returns all of them at once with their counts, and sends a plain, kind `message`.

**Included, flagged for Joseph:** the same database rule also refuses a **role change** that would leave a community with no Administrator, for example the only Admin demoting themselves to Member. It is the same risk through a different door, and the same trigger covers it with almost no extra work. If Joseph prefers removal only, drop the role half and say so in the PR.

### Repo Target
Web (`owgc-tech/flockpulse-web`): a migration, the members service, two API routes, and the admin member-edit form. **The migration must be applied BEFORE merge,** because the new code calls a new database function.

### Grounding Check
**Verified by Atlas this session** (`origin/dev` at `f2160bd`):
- **`remove_member(p_tenant_id, p_member_id, p_reason)`** is defined most recently in `20261006000083_audit_ids_only_and_removed_member_text.sql` (lines 246–341). It is `SECURITY DEFINER` and is granted to service_role only. It does ONE `UPDATE members SET deleted_at = now(), …` so that the guard triggers fire on it. It uses custom SQLSTATEs (`FP422`, `FP404`).
- **The three guard triggers on `members`** are `BEFORE UPDATE` and fire when `deleted_at` goes from NULL to non-NULL:
  - **`block_member_deactivation_if_assigned_leader()`** (latest text in `20260806000066`) counts active `assignments` rows where `leader_member_id = NEW.id`, `assignment_type = 'LEADER'` and `deleted_at IS NULL`. It raises `'Cannot deactivate member %: still assigned as Assigned Leader to % member(s) — reassign them first'`.
  - **`block_member_deactivation_if_owns_groups()`** (`20260719000049`) counts `groups` where `owner_member_id = NEW.id AND deleted_at IS NULL`.
  - **`block_member_deactivation_if_owns_events()`** (`20260720000052`) counts the member's events in their tenant with `status != 'CANCELLED'` whose effective status, via `get_events_effective_statuses(...)`, is not COMPLETED or LOCKED.
  - **Migration `20261004000079`** also references these, so **find the latest definition of each** and mirror *that* exactly.
- **`src/features/members/service.ts`:**
  - `mapRemoveMemberError()` matches `P0001` plus message substrings and attaches ONE of `assignedMemberCount`, `ownedGroupCount` or `ownedEventCount`. Its `message` stays the raw database text.
  - `removeMember()` calls `rpc('remove_member')`, then `auth.admin.deleteUser`.
  - `updateMember()` updates `members.role` (and `role_catalog_entry_id`, taking the role from the catalog entry's tier).
- **API:**
  - `DELETE /api/members?id=` (`app/api/members/route.ts`, admin) and `DELETE /api/members/me` (`app/api/members/me/route.ts`, self) both return `409 { error: { code: 'INVALID_STATE_TRANSITION', message, assignedMemberCount, ownedGroupCount, ownedEventCount } }`.
  - The PATCH that changes a member's role: find it.
- **Web form:** `app/admin/(shell)/members/[id]/edit/MemberEditForm.tsx` (lines 95–135) handles each 409 count separately. It shows a banner or link for the first count present, then falls back to `body.error.message`.
- **Phone (for reference only, not changed here):** `delete-account.tsx` `describeStateTransitionError()` shows the first non-null count as a sentence, otherwise `err.message`. `ApiError` in `src/lib/api.ts` carries the three counts.
- **Roles:** `src/lib/auth/middleware.ts` ranks roles. Admin tier is rank 3: `ADMIN` plus the Admin-tier synonyms. Confirm the exact list, expected `ADMIN`, `SR_COORDINATOR`, `COORDINATOR` and `COMMUNITY_SERVANT`, and check whether a SQL helper such as `is_admin_tier()` already exists. Reuse it if so.

**Re-verify all of the above first,** and report:
1. the latest definition of each of the three guard triggers;
2. the admin-tier role list, and any SQL helper;
3. the PATCH route and service path that change `role`;
4. the next free migration number (expected `20261119000086`).

**Rules check:**
- The error code is canonical: `INVALID_STATE_TRANSITION`, 409.
- Tenant comes from the token. New functions are closed to PUBLIC, anon and authenticated (FP-228).
- Messages contain no ids or names.
- The phone tolerates both old and new server responses (the new fields are additive).

### Implementation Plan
1. **Bootstrap.** Save this DIP verbatim to `documentation/dips/DIP-FP-258-web.md`. Create `feature/FP-258-removal-guards` off current `dev`. Report the four grounding answers before writing code.

2. **Migration** `supabase/migrations/20261119000086_last_admin_guard_and_removal_blockers.sql` (confirm the number):

   **a. Last-Admin trigger.** `public.block_last_admin_removal_or_demotion()` with the same header style as the other guards (`LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog`), attached to `members` as `BEFORE UPDATE OF deleted_at, role … FOR EACH ROW`:
   - It acts only when OLD is an **active Admin-tier** member (`OLD.deleted_at IS NULL` and `OLD.role` is Admin tier), **and** one of these is true:
     - `NEW.deleted_at IS NOT NULL` (removal);
     - `NEW.role` is not Admin tier (demotion).
   - **Serialize concurrent changes:** `PERFORM 1 FROM tenants WHERE id = OLD.tenant_id FOR UPDATE;`. This stops two Admins removing each other at the same moment.
   - If **no other** active Admin-tier member exists in the same tenant (`id <> OLD.id AND deleted_at IS NULL AND role` is Admin tier):
     - for a removal: `RAISE EXCEPTION 'LAST_ADMIN' USING ERRCODE = 'FP409'`;
     - for a demotion: `RAISE EXCEPTION 'LAST_ADMIN_DEMOTION' USING ERRCODE = 'FP409'`.
   - `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated`. A trigger function needs no grant.

   **b. Read-only pre-check.** `public.member_removal_blockers(p_tenant_id UUID, p_member_id UUID)`:
   - Returns one row: `assigned_member_count INT, owned_group_count INT, owned_event_count INT, is_last_admin BOOLEAN`.
   - It is `STABLE SECURITY DEFINER SET search_path = public, pg_catalog`.
   - Each count uses **exactly** the same conditions as the latest definition of its guard trigger. Copy them, and add a comment that the trigger and this function must always change together.
   - `is_last_admin` uses the same rule as (a).
   - For a member who doesn't exist or is already removed in that tenant, it returns zeros and false.
   - Revoke from PUBLIC, anon and authenticated; grant to `service_role`.

   **c. Idempotent:** `CREATE OR REPLACE`, `DROP TRIGGER IF EXISTS` then `CREATE TRIGGER`.

3. **Pure message helper** `src/features/members/removalBlockers.ts`, with no I/O:
   - `type RemovalBlockers = { assignedMemberCount: number; ownedGroupCount: number; ownedEventCount: number; lastAdmin: boolean }`;
   - `hasBlockers(b)`;
   - `describeBlockers(b, audience: 'self' | 'admin'): string[]`, which returns one plain sentence per block, in this order: last Admin, members led, groups, events. Use correct singular and plural, no ids, no names.
     - **self, lastAdmin:** "You are this community's only Administrator. Make another member an Administrator first, or email support@flockpulse.ca to close the community."
     - **self, members led:** "You lead N member(s). Ask your Administrator to assign them to another leader first."
     - **self, groups:** "You own N group(s). Ask your Administrator to give them to someone else first."
     - **self, events:** "You own N upcoming event(s). Ask your Administrator to give them to someone else first."
     - **admin, lastAdmin:** "This is the community's only Administrator. Make another member an Administrator first."
     - **admin, members led:** "This member leads N member(s). Reassign them first."
     - **admin, groups:** "This member owns N group(s). Give them to someone else first."
     - **admin, events:** "This member owns N upcoming event(s). Give them to someone else first."
   - `blockersMessage(b, audience)` joins the sentences with a space.
   - Demotion message, for the role PATCH: "This is the community's only Administrator, so their role can't be changed. Make another member an Administrator first."

4. **Service** (`members/service.ts`):
   - In `removeMember()`, **before** calling `remove_member`, call `rpc('member_removal_blockers', …)`. If `hasBlockers`, throw `INVALID_STATE_TRANSITION` with **all four** values attached, plus `message = blockersMessage(b, audience)`. The audience is `'self'` for `SELF_DELETED` and `'admin'` for `DEACTIVATED`.
   - Keep `mapRemoveMemberError()` as the **backstop** for a race between the check and the update. Extend it so that:
     - `FP409`/`LAST_ADMIN` maps to `lastAdmin: true`;
     - every mapped error uses the friendly `message`, not the raw database text;
     - the existing substring matches stay as they are.
   - In `updateMember()`, map `FP409`/`LAST_ADMIN_DEMOTION` to `INVALID_STATE_TRANSITION` with the demotion message.

5. **API routes** (`DELETE /api/members`, `DELETE /api/members/me`, and the role PATCH):
   - The 409 body becomes `{ error: { code: 'INVALID_STATE_TRANSITION', message, assignedMemberCount, ownedGroupCount, ownedEventCount, lastAdmin } }`.
   - **Back-compat:** send each count as a number when it is greater than 0. When it is 0, **omit it** (undefined), so older clients that test `!== undefined` or `!== null` behave as before.
   - `lastAdmin` is `true` or omitted.
   - The role PATCH returns 409 with the demotion message.

6. **`MemberEditForm.tsx`** (admin Remove and the role change):
   - On a 409 from Remove, show **every** block present, using the same sentences (`describeBlockers(…, 'admin')`), in one readable list.
   - Keep the existing helpful links: Bulk Reassign for members led, the Groups page, the Events page.
   - On a 409 from a role change, show the server `message`.
   - Never show raw database text.

7. **Scratch-database test** (`supabase db reset` locally). Plant:
   - **Tenant A:** two active Admins (one `ADMIN`, one Admin-tier synonym) and a Member.
   - **Tenant B:** one active Admin.
   - **Tenant A's second Admin also:** leads one member, owns one group and owns one upcoming event.
   - **Edge rows:** a removed (deleted) Admin, and a cancelled event.

   Then show:
   - Tenant B's only Admin: `remove_member` is refused with `FP409`, and demotion to MEMBER is refused.
   - Tenant A: one Admin can be removed while the other remains. Removing or demoting the last remaining one is refused.
   - `member_removal_blockers` returns all three counts for the blocked Admin, matching what the triggers count. Check that the cancelled event and the deleted rows are not counted.
   - Tenant isolation: Tenant A's actions never consider Tenant B's members.
   - Apply the migration twice: no error.
   - Privileges: anon and authenticated cannot execute either function.

   Paste the queries and results.

8. **Test script** `scripts/test-fp258-removal-blockers.ts` (force-added): pure tests of `describeBlockers` and `blockersMessage` (each block alone, all together, singular and plural, both audiences, no `-` ids in any message), plus the route body shape (zeros omitted). Also run the existing member, removal and audit test scripts, and report anything that fails that also fails on `dev`.

9. **Checks:**
   - Run `npx tsc --noEmit`, lint, `npm run build` and the scripts.
   - Run locally with `npm run dev` (MFA may block the browser; say what you could check). With curl and a test token if possible:
     - `DELETE /api/members/me` as a sole Admin returns 409 with `lastAdmin: true` and the friendly message;
     - a member with several blocks returns all of them.
   - `git diff dev --stat`. Stop the dev server.

10. **Commit, push, and open the PR** with `gh pr create --base dev`.

### Files to Create/Modify
- **Create:**
  - `documentation/dips/DIP-FP-258-web.md` (verbatim, then frozen);
  - `supabase/migrations/20261119000086_last_admin_guard_and_removal_blockers.sql`;
  - `src/features/members/removalBlockers.ts`;
  - `scripts/test-fp258-removal-blockers.ts`.
- **Modify:**
  - `src/features/members/service.ts`;
  - `app/api/members/route.ts`;
  - `app/api/members/me/route.ts`;
  - the role PATCH route found in grounding;
  - `app/admin/(shell)/members/[id]/edit/MemberEditForm.tsx`.
- **Must stay untouched:**
  - `remove_member()`. No migration may redefine it. Show `grep -n "remove_member" supabase/migrations/20261119000086*` with no `CREATE` of it.
  - `proxy.ts`, `src/lib/site-gate.ts`, `src/lib/auth/`.

### Migration Files (if applicable)
`20261119000086_last_admin_guard_and_removal_blockers.sql`, as described above. Validated locally only; never applied remotely by Claude Code.

**Order (important): Joseph applies it BEFORE merging,** because `removeMember()` calls `member_removal_blockers`. The migration alone is safe on today's code: it only adds a guard and an unused function.

### Branch Name
feature/FP-258-removal-guards

### Commit Message
FP-258: protect the last Administrator and report every removal block in plain words

### Pull Request Description
Plain GitHub markdown. **Start the description with: "Apply the migration before merging."** Then include:
- how each acceptance criterion is met;
- the flagged demotion rule;
- the scratch-database results;
- the message table, for both audiences;
- the response shape, and why it stays back-compatible;
- deviations from this DIP.

**Verification query for Joseph,** after applying:
```sql
SELECT * FROM member_removal_blockers('<OWGC tenant id>', '<your member id>');
```
Use the ids from the Members page URL or the tenants table. As OWGC's Admin you should see your own counts; `is_last_admin` is true only if you are OWGC's only Admin-tier member.

**Not tested:** the hosted database, the browser behind MFA, and the mobile app (next DIP).

**Steps for Joseph:**
1. Apply the migration in the SQL Editor on `fpdb-dev`.
2. Run the verification query.
3. Merge into `dev`, and wait for Vercel to show Ready.
4. On preview, as Admin:
   - try to Remove a test member who leads people and owns a group: you see **both** reasons in plain words, with links;
   - try to change the only Admin's role to Member in a test community, or confirm OWGC has other Admins: it is refused with the plain message;
   - Remove an ordinary member with no blocks: it still works.
5. Tell Atlas, who then sends `DIP-FP-258-mobile`.

### Jira Linkage
- PDEEpicID: FP-170
- PDEStoryID: FP-258

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-258-web.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Branch off current dev and open the PR with gh pr create --base dev; quote the base in your report and do NOT stack it on any other branch. Do not apply any migration to a remote database and do not merge: Joseph applies migrations after review, tests, and merges manually.

Include full diffs for every file in your completion report per Section 5, rule 13, not a summary.
