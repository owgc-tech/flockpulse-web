### DIP — FP-234 (Web): Deleted members must not linger inside task assignments

### Not covered — deliberately excluded
- The mobile edit screen (separate small mobile DIP).
- Restoring assignments when a member is reactivated: they must be re-assigned by hand.
- FP-222 indicators. The "bump the version only when the assignee changed" item moves into THIS DIP from FP-222.
- The event Target audience: inventory and report only (see step 5), unless it has the identical blocking problem.

### Story Summary
Deleted or deactivated members are left inside event_tasks_assignments.assignee. They are invisible in the pickers and make the server reject every save of that task (and, on mobile, of the whole event). Make saves resilient to stale ids, stop the problem at the source by removing a member from assignments when they are deleted or deactivated, and tighten update_task_assignment so it acts only on a real change.

### Repo Target
Web (Next.js and Supabase migrations). All shared backend and database work lives here.

### Grounding Check
Verified live with Joseph's query and the code this session, not assumed:
- Live data: five stale references. Game Master on three events (Lim MWG 20260711, 20261017, 20261114) holds one member deleted on 2026-10-04 19:35 UTC; Food Assignment on "Test 1 - limited Assignments" holds a different deleted member TWICE in the stored list, so duplicate ids can be stored. A deleted account shows first_name "Deleted" and last_name "Member" (the in-app delete scrubs the name); admin deactivation also sets members.deleted_at.
- validateAssignee (src/features/tasks/eventTaskAssignment.service.ts, about lines 43 to 80) queries members by tenant, deleted_at IS NULL and the id list, then compares the number of rows with memberIds.length. A stale id, or a repeated id, rejects the whole list with "assignee.member_ids contains a member that is invalid, soft-deleted, or belongs to a different tenant". The same pattern exists for group_ids.
- GroupMemberChipPicker builds chips by filtering the ACTIVE member list by the stored ids, so a stale id has no chip and cannot be removed. EventForm.syncTaskAssignments skips unchanged tasks.
- Nothing removes a deleted or deactivated member from event_tasks_assignments (searched the migrations). Precedent for deactivation triggers on members: block_member_deactivation_if_assigned_leader, block_member_deactivation_if_owns_events, block_member_deactivation_if_owns_groups and remove_member_from_everyone_group_on_deactivation. Read their definitions and copy their conventions.
- FP-221 slice 1 database functions: create_task_assignment, update_task_assignment, delete_task_assignment (atomic, service_role only), plus clear_responses_for_removed_assignees, bump_event_version_for_task_change and resolve_assignee_member_ids. update_task_assignment currently bumps events.version and clears responses on EVERY call, even when the assignee did not change.
- FP-228 convention: new functions are closed by default and are granted to service_role only. Trigger functions need no EXECUTE at fire time.
- A cleanup script was tested on a scratch PostgreSQL 16 copy (stale and duplicate ids pruned; groups kept; rows left empty deleted; current answers of deleted people cleared with history kept; healthy rows untouched; second run a no-op). Its three statements, quoted in Joseph's message of 2026-10-04, are the starting point for the migration cleanup and the trigger body.
- Re-verify the above yourself first, including the exact names and bodies of the existing deactivation triggers.

### Implementation Plan
1. Service (TypeScript): normalize the assignee before validating and saving. De-duplicate group_ids and member_ids. On UPDATE, load the stored assignment; any id that is stored but is no longer an active member (or group) is silently dropped; any NEWLY ADDED id that is invalid is still rejected with the existing error. Compare row counts against the de-duplicated list. The FP-220 limit check and the individual_only no-groups rule must use the normalized list. CREATE has no stored ids, so it stays strict apart from de-duplication.
2. Migration A: (a) the one-time cleanup, idempotent, using the tested three statements; (b) trigger function prune_deleted_member_from_assignments(), AFTER UPDATE OF deleted_at ON members, FOR EACH ROW, firing only when OLD.deleted_at IS NULL and NEW.deleted_at IS NOT NULL. In the same transaction, scoped to NEW.id and NEW.tenant_id: clear the member's current responses (cleared_reason REMOVED_FROM_ASSIGNMENT); remove the id from every assignee.member_ids; delete assignments left with no members and no groups; bump events.version and updated_at ONCE for every affected event, including events whose assignment was deleted (collect the event ids before deleting). SECURITY DEFINER, search_path set, REVOKE from PUBLIC, anon and authenticated, GRANT to service_role. Check how it interacts with the existing deactivation guard triggers and the unavailability trigger, and use SET LOCAL app.skip_unavailability_check where the other write functions do.
3. Migration B: replace update_task_assignment so that it compares the stored assignee with the new normalized one. If nothing changed, return the row without bumping events.version and without clearing any response. If it changed, keep today's behavior. Preserve its signature, its privileges and everything else it does.
4. Both deletion paths must be covered: the admin Members page deactivation and the in-app account deletion (DELETE /api/members/me). Confirm both set members.deleted_at on the same column so the trigger sees both.
5. Inventory every other place that stores member ids (for example events.target.member_ids) and report, with a read-only query, whether stale ids exist and whether the same blocking check applies. If it does, include the equivalent fix and say so; otherwise just report.
6. Validate locally first (supabase start, supabase db reset), never against the remote database.

### Files to Create/Modify
- src/features/tasks/eventTaskAssignment.service.ts (modify)
- supabase/migrations/20261004000076_prune_deleted_members_from_assignments.sql (new)
- supabase/migrations/20261004000077_update_task_assignment_only_on_change.sql (new)
- Only if step 5 finds the same problem: the equivalent files for that data

### Migration Files (if applicable)
Two migrations as above, written to disk and validated locally only. Joseph applies them to Supabase after review, then merges.

### Branch Name
feature/FP-234-web-prune-deleted-members-from-assignments

### Commit Message
FP-234-web: stop deleted members lingering in task assignments

### Pull Request Description
Maps to FP-234. Include evidence for each scenario, run on a local database:
1. A task with a stale stored member: updating it succeeds, the stale id is dropped, a newly added invalid id is still rejected.
2. Duplicate ids in the request or in storage are normalized.
3. Deactivating a member (admin path) and deleting an account (self path) both remove them from every task, delete tasks left empty, clear their current answers with history kept, and bump events.version once per affected event.
4. A task whose group stays is kept; other tenants are untouched.
5. update_task_assignment with an identical assignee does not bump the version or clear answers; with a changed assignee it does.
6. The migration cleanup run twice changes nothing the second time.
7. The existing deactivation guard triggers still work.
Also report the step 5 inventory, and what you could not test.

### Jira Linkage
- PDEEpicID: FP-31
- PDEStoryID: FP-234

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-234-web.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Branch off current dev and open the PR with gh pr create --base dev; quote the base in your report and do NOT stack it on any other branch. Do not apply any migration to the remote database and do not merge. Joseph applies both migrations after review, tests, and merges manually.

Include full diffs for every file in your completion report per Section 5, rule 12, not a summary.
