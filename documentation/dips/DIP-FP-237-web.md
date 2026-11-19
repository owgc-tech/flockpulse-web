### DIP — FP-237 (Web): Removed members leave no live links to anyone

### Not covered — deliberately excluded
- Audit log redaction and free-text scrubbing: that is FP-236, which builds on THIS DIP's version of remove_member() and starts only after this one is merged.
- Historical event rows: event attendees, RSVPs, attendance, answers and talk completions stay untouched and keep pointing at the removed member.
- Mobile, and the owns-groups and owns-events guards: unchanged.

### Story Summary
Product decision (Joseph, 2026-10-04): records of deactivated and self-deleted members, in any table, must not stay attached to their leader and must not count toward the leader's assigned members; their group memberships go too. Today the leader guard counts every LEADER assignment row of the leader without checking whether the assigned member was removed, so a leader can be blocked by people who no longer exist anywhere an admin can see, with nothing to click to fix it. Make removal detach the person from their leader, from their groups and from any other live link, make the guard ignore removed members, clean up the same for members already removed, and report which tables keep history and which held live links.

### Repo Target
Web (Next.js and one Supabase migration).

### Grounding Check
Verified this session by reading the migrations and code, not assumed:
- The latest leader guard is block_member_deactivation_if_assigned_leader (migration 20260806000066). It counts rows in assignments WHERE leader_member_id = NEW.id AND assignment_type = 'LEADER' AND deleted_at IS NULL, and raises "Cannot deactivate member %: still assigned as Assigned Leader to % member(s) — reassign them first". It never checks the assigned member's own deleted_at. The TypeScript mapping (mapRemoveMemberError in src/features/members/service.ts) matches the substrings 'still assigned as Assigned Leader' and 'to N member', so the message text must not change.
- assignments has tenant_id, member_id (the person being assigned), assignment_type IN ('GROUP','LEADER'), target_id, leader_member_id and a deleted_at soft-delete column (migrations 20260629000001 and later). Verify the CURRENT column list and what each column means for a LEADER row versus a GROUP row.
- remove_member(p_tenant_id, p_member_id, p_reason) is in migration 20261004000078 (FP-235). It scrubs the member row in one UPDATE, scrubs invitation rows, and returns the login id; the service then deletes the login. It is service_role only and idempotent. Read any existing deactivation trigger on members that already removes a group membership (for example for the Everyone group) so nothing is handled twice.
- member_unavailability_ranges (migration 20260811000070) has member_id, start_date, end_date; verify the full column list, including any free-text reason.
- getMyAssignedMembers and getGroupMembers (src/features/assignments/service.ts) take an activeOnly flag (FP-235). FP-235 deliberately kept removed members as anonymous rows in group-scoped rosters; this DIP reverses that for group membership, per Joseph. The admin reassign page (app/admin/(shell)/members/[id]/reassign/page.tsx) lists a leader's assigned members.
- FP-234 already prunes a removed member from task assignments inside the same removal.
- Re-verify all of this first.

### Implementation Plan
1. Migration 20261004000079_removed_members_leave_no_live_links.sql (confirm the next free number):
   a. CREATE OR REPLACE remove_member() keeping its signature, privileges, labels, idempotency and every existing behavior, and add, in the same transaction and also on the "already removed" branches so retries and the cleanup complete them: (i) soft-delete (set deleted_at = now()) ALL of the removed member's own assignments rows (their LEADER link and their GROUP memberships: assignments where member_id = the removed member AND deleted_at IS NULL); (ii) delete the removed member's member_unavailability_ranges rows; (iii) any other live per-person rows found by the inventory in step 3.
   b. CREATE OR REPLACE block_member_deactivation_if_assigned_leader() so it counts only LEADER rows whose assigned member (assignments.member_id) is not removed (join members, deleted_at IS NULL). Keep the exception text EXACTLY as it is.
   c. One-time cleanup, idempotent: for every member that is already removed, soft-delete their assignments rows and delete their unavailability rows. A second run changes nothing. Report the counts with RAISE NOTICE and make the same counts available through a query in the PR (the SQL Editor may not show notices).
2. Check the places that list or count a leader's assigned members and a group's members (the reassign page, the leader's my-members list, group member counts, the guard error's count): after step 1 they must show only active members and the count in the error must equal the people an admin can actually see and reassign. Fix anything that still shows a removed member.
3. Inventory, reported in the PR and implemented where it is a live link: list every table with a member id column (member_id, leader_member_id, owner_member_id, created_by, invited_by, actor_id and similar) and classify each as HISTORY (kept as is: attendance, RSVPs, answers, talk completions, event attendees, invited_by, audit actor ids) or LIVE (removed at removal: the leader link, group memberships, unavailability, and any per-person preferences, device or trust records and the like). Implement removal for the LIVE ones inside remove_member() and its one-time cleanup. Also list every roster or report that works out who is in a group live through group membership and therefore stops including removed people, and any current-state COUNT or LIST (group member counts, leader counts, owner pickers) that still includes removed members; confirm that event-level rows are untouched so each event's own totals do not change.
4. Validate locally first (supabase start and supabase db reset). Never apply the migration to the remote database.

### Files to Create/Modify
- supabase/migrations/20261004000079_removed_members_leave_no_live_links.sql (new; confirm the next free number)
- Any service or screen code the step 2 and step 3 inventories show still lists or counts removed members (list each)

### Migration Files (if applicable)
One migration, written to disk and validated locally only.

### Branch Name
feature/FP-237-web-removed-members-leave-no-live-links

### Commit Message
FP-237-web: removed members leave no live links and stop counting toward their leader

### Pull Request Description
Maps to FP-237. Include evidence from a local database:
1. A leader whose only assigned members are removed can be removed; a leader with at least one active assigned member is still blocked, and the count in the message equals the number of active members.
2. Removing a member soft-deletes their LEADER link and their group memberships and deletes their unavailability rows; their attendance, RSVPs, answers, talk completions and event-attendee rows are untouched and still point at the member.
3. The one-time cleanup handles members removed earlier, and a second run changes nothing; remove_member() run twice changes nothing the second time.
4. The FP-234 prune, the three guards (leader, groups, events), the FP-235 scrub and invitation scrubbing still behave as before (run the existing test scripts and compare with their baselines).
5. The step 3 classification table (history versus live), the list of rosters and reports whose group-based membership changes, and the step 2 findings.
State what you could not test.

### Jira Linkage
- PDEEpicID: FP-8
- PDEStoryID: FP-237

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-237-web.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Branch off current dev and open the PR with gh pr create --base dev; quote the base in your report and do NOT stack it on any other branch. Do not apply the migration to any remote database. Do not merge. Joseph applies the migration after review, then merges.

Include full diffs for every file in your completion report per Section 5, rule 12, not a summary.
