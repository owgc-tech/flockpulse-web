DIP-FP-54 — Admin Invites a New Member
Covers: FP-54 (Admin Invites a New Member — email, role, group chosen by Admin)
Epic: FP-8 (EPIC-2 — Member & Group Management)

Story Summary
Admin invites a person by email, choosing their role and group at invite time. This creates a real (pending, unconfirmed) Supabase Auth user immediately via inviteUserByEmail(), with tenant_id, role, and group_id stashed in that user's app_metadata — this is what registration completion (FP-55, separate DIP) reads from later, never trusting anything the registrant submits. Also creates the invitations table, a tenant-scoped record of every invite sent, independent of Supabase's own auth.users table (which has no tenant_id column and isn't reachable through the normal RLS-protected API surface).
This is the first time this codebase creates a Supabase Auth user without that person already existing as a members row — every prior write path in this project has operated on an already-established member. Treat the metadata-stashing step as security-critical: if tenant_id/role/group_id are wrong or missing in app_metadata at this step, FP-55's completion flow has nothing correct to read from later.

Repo Target
Web — owgc-tech/flockpulse-web, working branch dev.

Grounding Check

No local tool access this session to re-verify current file state before drafting — CC must confirm everything below against the real, current codebase before implementing, not assume this DIP's description of existing state is still accurate. This is standard practice every DIP, but worth stating explicitly given Atlas is working from conversation history only this time, not a fresh read of the repo.
invitations schema, as decided in design conversation: id, tenant_id, email, role, group_id (nullable), invited_by, auth_user_id, status (PENDING/ACCEPTED/REVOKED), invited_at, responded_at. Confirm this doesn't already exist in a later, undiscovered migration before creating it fresh.
Metadata stashed on the invited Auth user must include tenant_id, role, and group_id — this is the entire mechanism that lets FP-55 later create a correctly-scoped members row without ever trusting client input for tenant/role/group. Verify the exact inviteUserByEmail() options shape (metadata parameter name/structure) against Supabase's current SDK — don't assume from memory, confirm against the actual installed @supabase/supabase-js version in this repo.
This uses the Admin API (supabase.auth.admin.*), which requires the service-role key — same client pattern (serviceClient()) already used in every repository function this session. Not a new access pattern, just a new use of the existing one.
RLS on the new invitations table: tenant-scoped, Admin-only read/write — same standing pattern as every other admin-managed table this session (courses, event_types, etc.). No FOR ALL, no hard-delete path — matches the standing rule from migration 000003 onward.
Role and group are always the inviter's (Admin's) decision — never the registrant's, at any point, confirmed explicitly during design. This DIP does not build any mechanism for a registrant to select or influence either value.
No conflicts with Section 4 invariants. Additive RBAC and tenant isolation are unaffected — this is a new creation path for members, not a change to existing role/tenant enforcement.


Implementation Plan

Migration — invitations table:

Schema per Grounding Check item 2.
Cross-tenant safety trigger on group_id when not null (same pattern as every prior cross-table trigger this session — confirm group_id references groups(id) correctly and validate tenant match).
RLS: tenant-scoped SELECT/INSERT/UPDATE, Admin-only (caller_is_admin(), reused).


New service function — inviteMember(tenantId, invitedByMemberId, email, role, groupId):

Calls serviceClient().auth.admin.inviteUserByEmail(email, { data: { tenant_id, role, group_id } }) — confirm exact options shape against the installed SDK version before writing this, per Grounding Check item 3.
On success, captures the returned Auth user's ID.
Inserts a new invitations row: status = 'PENDING', auth_user_id = the ID just returned, invited_by = the acting Admin's member ID.
If the Supabase invite call fails, do not create the invitations row — don't leave a dangling record for an invite that was never actually sent.


New route — POST /api/invitations (Admin-only): accepts email, role, groupId (optional), calls the service function above, returns the created invitation.
Admin-facing Invite screen: email input, role dropdown (ADMIN/LEADER/MEMBER), group dropdown (real tenant groups + "No Group Yet" mapping to groupId = null).
Regression check: confirm this new table/route doesn't interfere with any existing Admin-facing flow — this is new surface area, not a modification of existing code, so risk here is lower than recent DIPs that touched already-shipped functions, but still confirm nothing else references a table/route name that collides.


Files to Create/Modify

New migration file (next sequential number after 000018 — confirm actual current head before assuming 000019)
src/features/invitations/invitation.types.ts, .repository.ts, .service.ts (new feature directory, matching established convention)
app/api/invitations/route.ts (new)
Admin Invite screen (new)
documentation/test-plans/FP-54-invitations-checklist.md


Branch Name
feature/FP-54-invite-member

Commit Message
FP-54: Admin invites a new member (invitations table, role/group locked at invite time)

Pull Request Description
Maps to FP-54's AC: invitations table created, Admin invite screen functional, Supabase Auth user created with correct tenant_id/role/group_id in metadata, confirmed via direct inspection of the created Auth user's metadata (not just "the call didn't error").

Jira Linkage

PDEEpicID: FP-8 (EPIC-2 — Member & Group Management)
PDEStoryID: FP-54 (Admin Invites a New Member)


Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-54.md and do not append executor notes after the initial save. Executor observations belong exclusively in the PR description.
Before writing any code: verify current schema state, current @supabase/supabase-js version and its inviteUserByEmail() metadata options shape, and current migration head number — this DIP was drafted without fresh local file access this session.
If any Jira ticket needs to be filed for a finding during this DIP, do not file it directly — report it back for Atlas to file.
Create the feature branch, implement, test (including direct inspection of the created Auth user's app_metadata — not just that the API call succeeded), commit, push, and open the PR against dev. Do not merge — the user will test locally and merge manually.
Include full diffs for every file in your completion report — not a summary.
