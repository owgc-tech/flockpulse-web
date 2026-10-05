### DIP — FP-235 (Web): Removing a member deletes their login and identifying details

### Not covered — deliberately excluded
- Reactivating or restoring a removed member: removed people return only through a fresh invitation as a brand-new member.
- Mobile: no change (in-app delete and session recovery already work).
- Data held by Supabase backups, Vercel logs, the email provider: outside our code. List them in the PR for the privacy policy (FP-171).
- Any change to which cases are blocked: the three guard triggers keep rejecting removal exactly as today.
- Any schema change to gender, marital_status or birthdate: they keep real values.

### Story Summary
Product decision (Joseph, 2026-10-04): when a member is removed from the system, for any reason, FlockPulse must not keep information that identifies them, but the member row and its primary key stay so records in other tables (attendance, RSVPs, answers, talk completions, assignments) are never orphaned and keep counting in organization statistics. Today only a member's own in-app delete scrubs the person, and it overwrites demographic fields with fake placeholders. An admin's Deactivate only sets deleted_at and leaves the person's name, email and a live login, so re-inviting the same email fails ("already registered"). Make both paths do the same thing: delete the login (frees the email), remove the identifying details, and label the anonymous record with HOW the person left: first name "Self-deleted" and last name "User" for in-app delete, first name "Deactivated" and last name "User" for an admin removal. Gender and marital status stay as they were, and the birthdate is kept as the birth year only (January 1 of that year), so organization statistics stay accurate without keeping an exact date of birth. Also close a gap neither path covers today: the invitee's email kept on invitation rows.

### Repo Target
Web (Next.js and one Supabase migration).

### Grounding Check
Verified live this session, not assumed:
- softDeleteMember (src/features/members/service.ts, about line 311) only UPDATEs members.deleted_at and maps three guard-trigger errors (still assigned as Assigned Leader, still owns group(s), still owns event(s)). deleteOwnAccount (about line 387) does one UPDATE setting deleted_at, email = 'deleted-<memberId>@deleted.invalid', first_name 'Deleted', last_name 'Member', gender 'MALE', marital_status 'SINGLE', birthdate '1990-01-01', maps the same three guard errors, and THEN calls auth.admin.deleteUser(userId), throwing AUTH_DELETE_FAILED ("Account deactivated but Auth identity deletion failed: ...") if that fails.
- Callers: the admin DELETE handler (app/api/members/route.ts, about line 99) calls softDeleteMember(id, tenantId); app/api/members/me/route.ts (about line 54) calls deleteOwnAccount(ctx.userId, ctx.tenantId, ctx.memberId). UI: app/admin/(shell)/members/[id]/edit/MemberEditForm.tsx, handleDeactivate, with a browser confirm("Deactivate X? They will no longer appear in active member lists.").
- gender, marital_status and birthdate are NOT NULL with CHECK constraints (gender MALE or FEMALE; marital_status one of five values; migrations 20260629000020 and 20260708000027). That is why the current scrub writes placeholders. Only the profile and registration screens read them today; no report uses them. Verify with a search of all code and SQL, including reports and any SQL functions.
- Earlier in-app deletes already overwrote the real values with those placeholders; they cannot be recovered.
- invitations.email is TEXT NOT NULL and neither path touches invitation rows. invitations also holds auth_user_id (the login account); check its foreign-key behavior when the Auth user is deleted.
- Member edits and removals write no audit entries; audit_logs keeps actor_id permanently (an id, not a name) and before_value/after_value JSON for other entities.
- members.user_id is globally UNIQUE; the unique email index is per tenant among ACTIVE members only (idx_members_unique_active_email_per_tenant, verify it is partial), so a scrubbed record never blocks a returning person. A new invitation creates a new login, hence a new member row.
- Already in place when a member's deleted_at is set: the FP-234 trigger prunes them from task assignments and clears their answers; FP-230 returns their phone to login; the three guard triggers can still reject the removal.
- Re-verify all of the above, including the full current list of personal-detail columns on members (a phone or photo column may exist; remove every identifying one).
- Repo rules that apply: a write across more than one table in one action is a single SECURITY DEFINER function, closed to PUBLIC, anon and authenticated and granted to service_role only (FP-228 convention).

### Implementation Plan
1. Migration 20261004000078_remove_member_function.sql:
   a. A SECURITY DEFINER function remove_member(p_tenant_id, p_member_id, p_reason) where p_reason is 'SELF_DELETED' or 'DEACTIVATED' (anything else is rejected). In ONE transaction it (i) reads the member's user_id and original email, (ii) runs ONE UPDATE that sets deleted_at, email = 'deleted-<memberId>@deleted.invalid', first_name and last_name to 'Self-deleted'/'User' for SELF_DELETED or 'Deactivated'/'User' for DEACTIVATED, birthdate to January 1 of its own year (make_date(extract(year from birthdate), 1, 1)), clears every other identifying column (phone, photo reference and so on, if any), and leaves gender and marital_status unchanged. The single UPDATE means the guard triggers and the FP-234 prune trigger fire on it, and a rejecting guard aborts everything. (iii) scrubs invitation rows for that person (match on auth_user_id and on the original email within the tenant): email becomes the same placeholder, PENDING invitations are revoked, rows are never deleted (they carry invited_by and role history), respecting the table's unique rules. (iv) returns the user_id. It must be idempotent: for a member that is already removed it returns the user_id again, still scrubs any remaining invitation rows, and does not shift the birthdate year again.
   b. One-time relabel, idempotent: members whose email matches 'deleted-%@deleted.invalid' and whose name is still 'Deleted'/'Member' (all from earlier in-app deletes) become 'Self-deleted'/'User'. Leave their placeholder gender, marital status and birthdate as they are, and report how many such rows exist so reports can exclude them if needed.
2. Service: one shared routine, for example removeMember(memberId, tenantId, reason), used by BOTH the admin handler (reason DEACTIVATED) and the in-app path (reason SELF_DELETED): call remove_member, then auth.admin.deleteUser(user_id). Keep the existing error mapping (the three guards map to INVALID_STATE_TRANSITION with their counts; a failed login deletion throws AUTH_DELETE_FAILED). Order matters: the record is scrubbed first, so a guard rejection never deletes anyone's login.
3. Retryable: if a previous attempt scrubbed the member but the login deletion failed (or the member was deactivated before this change and still has a login), calling remove again finishes the job instead of returning NOT_FOUND.
4. Admin route and UI: the DELETE handler uses the shared routine. In MemberEditForm.tsx rename Deactivate to Remove and replace the confirm text with: "Remove {name}? This permanently deletes their login and personal details. Their past activity stays but shows as 'Deactivated User'. This cannot be undone. To return, they need a new invitation and start as a new member." Show a clear message when the login deletion fails ("Removed, but the login account could not be deleted. Try Remove again."). Where the UI says Deactivated for a removed member use Removed.
5. Per-person versus aggregate behavior. Inventory every screen, API route and report that shows or counts members and implement this rule: per-person screens (member list, member detail and edit, member progress by person, person pickers for owners, leaders and task assignees) must NOT offer a removed person; roster-style reports (RSVP roster, attendance roster, event roster, mobile roster) keep an anonymous row labelled with the generic name so totals add up; aggregate counts keep including them. Make no change to counting logic that already includes them. List what you found and changed in the PR.
6. One-time cleanup of members already deactivated before this change that still hold their name and email and a live login (find with: deleted_at IS NOT NULL AND email NOT LIKE 'deleted-%@deleted.invalid'). Provide a Node script using the service role that runs the same shared routine per member with reason DEACTIVATED, with a DRY RUN by default that only lists who would be removed (by id and removal date, never printing names or emails) and an explicit flag to execute. Commit it (force-add if scripts/ is ignored). Do not run it against any remote database; Joseph runs it after review.
7. Inventory and report: any other place a removed person's name or email can persist: audit_logs before_value/after_value JSON (search for email-like or name text), free-text fields the member authored (RSVP reasons, self-report feedback, attendance reasons), storage files (profile photo), and provider logs. Scrub what the routine can safely scrub; list the rest in the PR, together with what Supabase backups and provider logs retain, so the privacy policy (FP-171) can state it accurately.
8. Validate locally first (supabase start and supabase db reset). Never apply the migration or run the script against the remote database.

### Files to Create/Modify
- supabase/migrations/20261004000078_remove_member_function.sql (new; confirm the next free number)
- src/features/members/service.ts (modify)
- app/api/members/route.ts (modify)
- app/api/members/me/route.ts (modify only if needed to use the shared routine)
- app/admin/(shell)/members/[id]/edit/MemberEditForm.tsx (modify)
- Member list, picker, report and roster code touched by the step 5 inventory (list each)
- scripts/maintenance/remove-already-deactivated-members.mjs (new; force-add if ignored)

### Migration Files (if applicable)
One migration as described, written to disk and validated locally only.

### Branch Name
feature/FP-235-web-remove-member-fully

### Commit Message
FP-235-web: removing a member deletes their login and identifying details

### Pull Request Description
Maps to FP-235. Include evidence, run on a local database:
1. Removing through the admin path (label Deactivated User) and through the in-app path (label Self-deleted User) leaves scrubbed rows that differ only in that label: deleted_at set, email placeholder, birthdate reduced to January 1 of its year, gender and marital status unchanged, and no login for either.
2. Re-inviting the same email afterwards succeeds and creates a brand-new member.
3. A guard rejection (assigned leader, owns groups, owns events) leaves the member, their details and their login completely untouched.
4. A failed login deletion leaves a state the next Remove completes, and removing twice never shifts the birthdate year again.
5. Invitation rows for that person are scrubbed, pending ones revoked, others untouched; a member with the same email in another community is untouched.
6. The FP-234 prune still fires, and the removed person's answers are cleared with history kept; their attendance, RSVP and talk-completion rows still exist and still point at the member.
7. New registration still requires gender, marital status and birthdate (nothing relaxed).
8. The step 5 inventory with what was changed, and the step 7 inventory. The cleanup script's dry run lists only members that still hold details or a login, and its execute mode removes them. The count of legacy placeholder rows from step 1b.
State what you could not test.

### Jira Linkage
- PDEEpicID: FP-8
- PDEStoryID: FP-235

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-235-web.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Branch off current dev and open the PR with gh pr create --base dev; quote the base in your report and do NOT stack it on any other branch. Do not apply the migration and do not run the cleanup script against any remote database. Do not merge. Joseph applies the migration after review, runs the script's dry run, then merges.

Include full diffs for every file in your completion report per Section 5, rule 12, not a summary.
