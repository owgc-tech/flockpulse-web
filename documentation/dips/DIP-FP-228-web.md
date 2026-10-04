### DIP — FP-228 (Web): API-only data access

### Story Summary
The live database was reachable directly by anonymous and logged-in callers. A stop-gap was applied by hand on 2026-10-04 (anon locked out of all tables and functions; authenticated lost all table write privileges). This DIP makes that permanent and finishes the job: logged-in users get no direct table or function access except the two registration functions, so every read and write goes through the Next.js API (service role), where role checks live. It also puts the stop-gap into a migration so the repo matches the database, and adds a re-runnable check so this cannot quietly regress.

### Repo Target
Web (Supabase migrations, one server page, one registration form, scripts). Mobile needs no change: it makes no direct table or function calls (verified).

### Grounding Check
Verified this session, live and in code, not assumed:
- Live before-state: authenticated could UPDATE members (including the role column) and DELETE tenants. Live after-stop-gap: anon has no table access (25 of 25 tables false); no table has any authenticated write privilege; no SECURITY DEFINER function is executable by anon.
- The first stop-gap ended with GRANT EXECUTE ON ALL FUNCTIONS TO authenticated, which wrongly re-opened the 8 server-only functions (the 7 FP-221 functions plus get_events_effective_statuses) to logged-in users. They were re-locked by hand and verified live. Do not repeat that grant.
- withAuth (src/lib/auth/middleware.ts) reads the caller's role from members.role using the service role. RLS policies check tenant only, not role; a migration comment states role escalation is "prevented at the application layer, not the policy level".
- No code path writes to a table as anon or authenticated. The only user-scoped table READS found: tenants (app/admin/(shell)/invitations/page.tsx line ~27, via the user-scoped server client) and role_catalog (app/register/complete/CompleteProfileForm.tsx line ~70, a client component using supabaseAuthedClient). Both must move server-side before SELECT is revoked. The mfa-enroll and mfa-challenge actions already use the service role.
- complete_registration and the founder registration function are called with the user's own token on top of the anon key (registrantClient, founderClient), so they run as authenticated and must stay executable by authenticated.
- RLS helper functions (get_tenant_id, caller_is_admin, caller_is_leader_for_member, caller_member_is_leader_or_admin, caller_owns_member, caller_has_pending_invitation) are used by the policies. Once authenticated has no table privileges the policies never evaluate for it, so these helpers no longer need to be executable by authenticated.
- The stop-gap SQL was run by hand and is not in the repo.
- Re-verify all of the above yourself before relying on it: in particular search for ANY other user-scoped client, including ones passed into repository functions as parameters, since only files that build a client were scanned.

### Implementation Plan
1. Migration 20261004000075_api_only_data_access.sql, fully idempotent, in this order:
   a. Re-state the stop-gap: revoke function execute from PUBLIC and anon; revoke all table privileges and all sequence privileges from anon; revoke insert, update, delete, truncate, references, trigger on all tables from authenticated; matching ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public. Do NOT include the old "grant execute on all functions to authenticated" line; step 1c decides who keeps EXECUTE.
   b. Revoke SELECT on all tables from authenticated. Keep USAGE on schema public.
   c. Functions: for every non-trigger function in public (derive the list from pg_proc, prorettype <> trigger, do not hand-type signatures), REVOKE EXECUTE FROM authenticated, then GRANT back ONLY the two registration functions (complete_registration, and the founder registration function whose exact name you must confirm from founderClient.rpc in founder-registration.service.ts). service_role keeps everything. Trigger functions are left alone (they are not callable directly and the privilege is not checked at fire time).
   d. Default privileges for the future: new functions and tables created by postgres in public are not accessible to PUBLIC, anon or authenticated by default (service_role keeps access).
   e. Do not drop the existing RLS policies in this migration. They stay as a second layer.
2. Registration functions: audit complete_registration and the founder function. Each must derive tenant, role and identity from auth.uid() and the invitation row, never from caller-supplied arguments. If either trusts an argument for tenant or role, fix it in this DIP or flag it in the PR as a blocker. Also note in the PR whether create_tenant_and_founding_admin is limited per user (one tenant per account) or can be called repeatedly.
3. Move the two user-scoped reads server-side:
   - invitations/page.tsx: read the tenant name through the existing service-role path (for example getTenantSettings) instead of the user-scoped client.
   - CompleteProfileForm.tsx: the role title lookup must not use the user's token against role_catalog. Provide it from the server (server component prop, or a small authenticated API route using withAuth and the service role). Do not widen anything else.
4. Scripts (no keys committed; values come from environment variables):
   - scripts/security/check-db-privileges.sql: read-only; returns rows ONLY on violations (anon or authenticated with any table privilege; anon or authenticated with EXECUTE on any non-trigger function other than the allow-listed registration functions; any table without RLS enabled).
   - scripts/security/probe-direct-access.mjs: sends harmless probes with (a) the anon key alone and (b) anon key plus a member JWT, and reports PASS or FAIL. Probes must be side-effect-free even if permitted: PATCH members and DELETE tenants using a nonexistent UUID filter (permission denied is the PASS; a 204 with zero rows means the privilege exists, which is a FAIL); a GET on members, tenants and events (must be denied); and one read-only function (get_event_effective_status with a random UUID) over /rest/v1/rpc. Never call an action function.
5. Rollback script in the PR description (the GRANTs that restore the pre-migration state, generated from a before-snapshot of the privileges).
6. Verify locally with supabase start and supabase db reset, then run web and mobile flows against it: login, events create and edit, RSVP, self-report, confirmations, attendance override, task assignment, auto-assign, member and role edits, invite and registration, founder registration, community settings, password change, MFA enrol and challenge. Everything must work with authenticated holding no table SELECT and no function EXECUTE except the registration functions.
7. Never apply to the remote database. Joseph applies it after review.

### Files to Create/Modify
- supabase/migrations/20261004000075_api_only_data_access.sql (new)
- scripts/security/check-db-privileges.sql (new)
- scripts/security/probe-direct-access.mjs (new)
- app/admin/(shell)/invitations/page.tsx (modify)
- app/register/complete/CompleteProfileForm.tsx (modify)
- Possibly one small route under app/api/ for the role title, only if a server-side prop is not feasible
- Registration function fixes in the same migration only if the audit in step 2 finds a problem

### Migration Files (if applicable)
One migration as described in step 1, written to disk and validated locally only.

### Branch Name
feature/FP-228-web-api-only-data-access

### Commit Message
FP-228-web: API-only data access (lock functions and tables to the server, close defaults)

### Pull Request Description
Maps to FP-228: the database no longer trusts the app for security. Include in the PR body: the before and after output of check-db-privileges.sql (zero rows after); the PASS or FAIL table from probe-direct-access.mjs run locally with the anon key and with a member JWT; the registration-function audit result; the full list of user-scoped table or function accesses you found and how each was handled; the regression checklist with a yes or no per item; and the rollback script. State clearly anything you could not test.

### Jira Linkage
- PDEEpicID: FP-170
- PDEStoryID: FP-228

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-228-web.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against dev and stop. Do not merge and do not apply any migration to the remote database. Joseph applies it after review, then runs the same probe script against dev with a real member token, then merges.

Include full diffs for every file in your completion report per Section 5, rule 12, not a summary.
