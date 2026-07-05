DIP-FP-101 — Founder Self-Registration (New Tenant + Founding Admin)
Covers: FP-101 (Founder Self-Registration — New Tenant + Founding Admin) Epic: FP-5 (EPIC-1 — Tenant & Access Control)
Story Summary
The very first member of a brand-new community self-registers with no invite, no existing tenant, and no existing Admin — because none of those exist yet. This is fundamentally different from every prior registration path this session: FP-54/55 always assumed an Admin already existed to send the invite; this is the one flow where that assumption is false by definition. Creates the tenant itself and the founder's own `members` row as `ADMIN`, atomically tied together, gated only by standard email confirmation.
This is the first time this codebase calls `supabase.auth.signUp()` directly — every prior Auth-creation path used `inviteUserByEmail()` (an Admin API call requiring the service-role key, driven by an existing Admin). `signUp()` is a public, client-callable method requiring no existing privileged actor at all — that's precisely why it's the right primitive here, and precisely why it needs to be treated as new, unproven surface area, not a variation on FP-54's pattern.
Repo Target
Web — `owgc-tech/flockpulse-web`, working branch `dev`.
Grounding Check

1. No local tool access this session to re-verify current file/schema state before drafting — CC must confirm everything below against the real, current codebase before implementing. In particular: confirm the actual current `tenants` table schema (this DIP assumes `id, name, attendance_window_hours` with `attendance_window_hours` having a `DEFAULT 24` — confirm this default exists rather than hardcoding 24 in the new function, which would duplicate a value that may already live in the column definition).
2. Real, unverified gap: how does Supabase's own email-confirmation link actually deliver the confirmed session back to this app? FP-55 dealt with `setSession()` reading `access_token`/`refresh_token` from a URL hash on an invite link. A `signUp()` confirmation link may use the same mechanism, or a different one (a PKCE-style `code` param requiring `exchangeCodeForSession()`), depending on this project's actual Supabase Auth configuration. Do not assume the FP-55 pattern transfers unchanged — confirm the real confirmation-link shape this project's Supabase settings actually produce before building the landing page that receives it.
3. Stashing founder-provided data across the email-confirmation gap: since there's a real-world pause here (the founder leaves the app, checks their inbox, clicks a link), the registration form's data needs to survive that gap. Use `signUp()`'s own `options.data` parameter — this is the exact same mechanism already confirmed this session to map to `user_metadata` (FP-54's grounding: "the `data` option maps to `user_metadata`, not `app_metadata`") — stash `community_name`, `first_name`, `last_name`, `gender`, `marital_status`, `birthdate` there at signup time. `user_metadata` is genuinely readable client-side after confirmation (unlike `app_metadata`), so the completion page can read it straight off the confirmed user object — no need to invent a second state-passing mechanism.
4. New atomic function `create_tenant_and_founding_admin()` — the core of this DIP. Takes the profile fields as explicit parameters (read from `user_metadata` by the calling code, not trusted implicitly inside the function — same discipline as `complete_registration()` taking explicit parameters rather than reading claims itself). Creates the `tenants` row, creates the founder's `members` row (`role = 'ADMIN'`, tied to the new `tenant_id`), and writes two audit log entries — one `entity_type = 'tenant', action = 'create'`, one `entity_type = 'member', action = 'register'` — matching FP-48's established granularity (one entry per mutated row, not one combined entry for two different entities).
5. One-person-one-tenant is already structurally guaranteed, confirmed against current schema — the function doesn't need to build this check itself, just handle the failure cleanly. `members.user_id UUID UNIQUE NOT NULL` means one Auth user can never have more than one `members` row, system-wide. If someone who already has a `members` row somehow reaches this flow again, the `INSERT` will hit that unique constraint — catch it and surface a clear, human error ("This account is already registered to a community"), not a raw constraint violation.
6. Critical, easy-to-miss step: `app_metadata` (tenant_id, role, member_id) must be written via the service-role Admin API after the RPC succeeds — the founder's existing browser session's JWT will not reflect it until refreshed. Same two-step application-layer pattern as FP-55's `registration.service.ts`. Additionally: after the `app_metadata` write, the client-side session must call `supabase.auth.refreshSession()` — the update happens server-side via the Admin API and does not automatically propagate to an already-issued JWT sitting in the browser. Skipping this step would leave the founder in a confusing "registered successfully, but nothing works" state, since `withAuth()`-style checks read `tenant_id`/`role` directly from JWT claims, not a live DB lookup.
7. Sequencing dependency on FP-102, deliberate: this DIP does not build its own session-establishment/login mechanism. Upon successful completion, redirect the founder to FP-102's login screen to authenticate fresh (their password already works, email is now confirmed) rather than this DIP inventing a second, parallel way to establish a working session. FP-102 is where the real cookie/session mechanics (`@supabase/ssr` + middleware, replacing the currently-nonexistent `sb-access-token` cookie check) belong — don't duplicate that logic here.
8. No additional tenant-defining fields beyond `name` — confirmed explicitly, deliberate day-2 scope, not an oversight. The `tenants` table has no other columns today.
9. Community name uniqueness is not enforced — flagged, not a gap. Two different tenants could share the same display name; tenant identity is by `id`, not `name`. This is a UX/branding consideration, not a data-integrity one, and no uniqueness constraint is being added unless asked for.
10. No conflicts with Section 4 invariants. Additive RBAC and tenant isolation are unaffected — this is the one legitimate path by which a new tenant boundary gets created in the first place, not a change to how isolation is enforced once it exists.
Implementation Plan

1. Migration — `create_tenant_and_founding_admin()`:
sql

```sql
   CREATE OR REPLACE FUNCTION public.create_tenant_and_founding_admin(
       p_community_name  TEXT,
       p_first_name      TEXT,
       p_last_name       TEXT,
       p_gender          TEXT,
       p_marital_status  TEXT,
       p_birthdate       DATE
   )
   RETURNS TABLE (tenant_id UUID, member_id UUID)
   LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = public, pg_catalog
   AS $$
   DECLARE
       v_tenant_id UUID;
       v_member_id UUID;
       v_email TEXT;
   BEGIN
       -- Defensive check, even though the unique constraint below would also catch this —
       -- gives a clear, human error instead of a raw constraint violation.
       IF EXISTS (SELECT 1 FROM members WHERE user_id = auth.uid()) THEN
           RAISE EXCEPTION 'This account is already registered to a community';
       END IF;

       SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();

       INSERT INTO tenants (name)
       VALUES (p_community_name)
       RETURNING id INTO v_tenant_id;

       PERFORM write_audit_log(v_tenant_id, 'tenant', v_tenant_id, 'create', NULL, NULL, to_jsonb((SELECT t FROM tenants t WHERE t.id = v_tenant_id)));

       INSERT INTO members (
           tenant_id, user_id, email, first_name, last_name, role,
           gender, marital_status, birthdate
       )
       VALUES (
           v_tenant_id, auth.uid(), v_email, p_first_name, p_last_name, 'ADMIN',
           p_gender, p_marital_status, p_birthdate
       )
       RETURNING id INTO v_member_id;

       PERFORM write_audit_log(v_tenant_id, 'member', v_member_id, 'register', v_member_id, NULL, to_jsonb((SELECT m FROM members m WHERE m.id = v_member_id)));

       RETURN QUERY SELECT v_tenant_id, v_member_id;
   END;
   $$;
```

Note: `attendance_window_hours` deliberately omitted from the `INSERT` — let the column's existing default apply (confirm it exists per Grounding Check item 1, don't hardcode `24` here).

1. Public registration screen (no auth required): community name, first/last name, gender, marital status, birthdate, email, password. Calls `supabase.auth.signUp({ email, password, options: { data: { community_name, first_name, last_name, gender, marital_status, birthdate } } })`.
2. Confirmation-landing page — receives the confirmed session per whatever mechanism Grounding Check item 2 confirms. Reads the now-available `user_metadata` off the confirmed user object.
3. Completion service function, mirroring `registration.service.ts`'s two-step shape:
   * Call `create_tenant_and_founding_admin()` via RPC, authenticated as the founder (their own access token, so `auth.uid()` resolves correctly), passing the fields read from `user_metadata`.
   * On success, using the service-role client, call `updateUserById()` to set `app_metadata: { tenant_id, role: 'ADMIN', member_id }`.
   * Call `supabase.auth.refreshSession()` client-side to sync the new claims (Grounding Check item 6).
   * Redirect to FP-102's login page (Grounding Check item 7) — do not attempt to carry the founder directly into `/admin/*` from this flow.
4. Regression check: confirm this doesn't interfere with FP-54/55's invite-based flow — this is new, parallel surface area, not a modification of existing invite/registration code.
Files to Create/Modify

* New migration file (confirm actual current head before assuming a specific number — should be `000022` if nothing else has landed since `000021`)
* `src/features/founder-registration/founder-registration.types.ts`, `.service.ts` (new feature directory)
* Public registration screen (new) — likely `app/register/founder/page.tsx` + supporting form component
* Confirmation-landing / completion page (new) — likely `app/register/founder/complete/page.tsx`
* `documentation/test-plans/FP-101-founder-registration-checklist.md`
Branch Name
`feature/FP-101-founder-registration`
Commit Message
`FP-101: Founder self-registration (new tenant + founding admin)`
Pull Request Description
Maps to FP-101's AC: public registration screen collects community + founder profile, `signUp()` creates the pending Auth user with data stashed in `user_metadata`, confirmation-landing page reads it back and calls the new atomic function, `app_metadata` set and session refreshed before redirecting to login. States clearly what the real Supabase confirmation-link mechanism turned out to be (Grounding Check item 2), since that was unverified at drafting time.
Jira Linkage

* PDEEpicID: FP-5 (EPIC-1 — Tenant & Access Control)
* PDEStoryID: FP-101
Stop Point
Save this DIP verbatim to `documentation/dips/DIP-FP-101.md` and do not append executor notes after the initial save. Executor observations belong exclusively in the PR description.
Before writing any code: verify current schema state (`tenants` table columns and defaults), and — critically — verify the actual shape of this Supabase project's email-confirmation redirect (URL hash tokens vs. PKCE code exchange) before building the confirmation-landing page around an assumption carried over from FP-55's invite-link handling.
If any Jira ticket needs to be filed for a finding during this DIP, do not file it directly — report it back for Atlas to file.
All changes go through a feature branch and a PR — no direct pushes to `dev`, no exceptions.
Create the feature branch, implement, test (including direct verification that a second registration attempt by the same Auth user is rejected cleanly, that both audit log entries are genuinely present with correct entity types, and that the post-registration `app_metadata` is actually correct via direct inspection — not just "the call didn't error"), commit, push, and open the PR against `dev`. Do not merge — the user will test locally and merge manually.
Include full diffs for every file in your completion report — not a summary.
