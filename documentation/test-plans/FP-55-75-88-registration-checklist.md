# Test Plan: FP-55 / FP-75 / FP-88 — Registrant Completes Registration

**Scope:** Migration 000020, `complete_registration()` SECURITY DEFINER function, registration service, set-password page, complete-profile page.

**Test script:** `scripts/test-fp55-registration.ts` — 15/15 PASS (2026-07-05)

---

## Group 1 — Schema / Migration Correctness

| # | What is tested | How | Expected |
|---|---|---|---|
| 1.1 | `gender`, `marital_status`, `birthdate` columns added to `members` | `information_schema.columns` | All three present |
| 1.2 | `gender` CHECK constraint rejects values outside `('MALE','FEMALE')` | Direct psql INSERT with `'OTHER'` | `check constraint "members_gender_check"` error |
| 1.3 | `marital_status` CHECK rejects values outside `('SINGLE','MARRIED')` | Direct psql INSERT with `'DIVORCED'` | `check constraint "members_marital_status_check"` error |
| 1.4 | `birthdate` NOT NULL enforced | Direct psql INSERT with `NULL` birthdate | NOT NULL violation error |
| 1.5 | Seed members have values for all three columns | Count query on seed tenant | 3 rows with all columns populated |

---

## Group 2 — `complete_registration()` Security Model

| # | What is tested | How | Expected |
|---|---|---|---|
| 2.1 | Caller with **no PENDING invitation** is rejected | Auth user, no invitation row, signed in; calls `complete_registration` via registrant-authed client | Error: `"No pending invitation found for this account"` |
| 2.2 | Valid PENDING invitation → member row created, invitation marked ACCEPTED | Auth user with PENDING invitation row, signed in; calls `complete_registration` | `members` row present; `invitations.status = 'ACCEPTED'` |
| 2.3 | Group assignment created when invitation has `group_id` set | Inspect `assignments` after 2.2 | One `GROUP` assignment row for the new member |
| 2.4 | `member.role` and `member.tenant_id` sourced from invitation, not caller | Inspect `members` row from 2.2 | Matches the invitation's `role` and `tenant_id` exactly |
| 2.5 | Audit log written: `entity_type='member'`, `action='register'`, `before=NULL` | Query `audit_logs` by `entity_id` | Row with correct fields; `actor_id = member_id`; `before_value IS NULL` |
| 2.6 | Replay blocked — second call with same Auth user (invitation now ACCEPTED) rejected | Call `complete_registration` again with same token | Error: `"No pending invitation found for this account"` |

---

## Group 2b — Defense-in-Depth RLS INSERT Policy (Direct Path)

These tests bypass `complete_registration()` entirely and attempt raw INSERTs via an authenticated client (anon key). This is the only way to verify the `members_registration_insert` policy in isolation — the SECURITY DEFINER function bypasses RLS and cannot exercise it.

| # | What is tested | How | Expected |
|---|---|---|---|
| 2.7 | RLS INSERT policy **permits** a user WITH a PENDING invitation to insert directly | Authenticated client (no service-role), PENDING invitation in DB; `INSERT` without `.select()` (SELECT policy blocks registrant from reading back their own row — `get_tenant_id()` = NULL); row verified via direct psql count | INSERT succeeds; row confirmed present |
| 2.8 | RLS INSERT policy **rejects** a user WITHOUT a PENDING invitation | Same client after invitation is marked ACCEPTED (from 2.7 cleanup) | INSERT rejected: `"new row violates row-level security policy for table 'members'"` |

**Implementation note — `caller_has_pending_invitation()` SECURITY DEFINER function:** The policy's EXISTS subquery against `invitations` must run as postgres. If it ran as the calling user, the `invitations` admin-only SELECT policy would block it and the EXISTS would always return false — making the policy accidentally deny all direct inserts. The SECURITY DEFINER helper function resolves this. The `invitations_select_self` policy (added in this migration) is independent — it lets registrants read their own invitation row for UI purposes (status display, etc.).

**Implementation note — `.select()` after INSERT:** The test does NOT chain `.select('id').single()` on the INSERT call. The registrant has no tenant in `app_metadata`, so `get_tenant_id()` returns NULL, and the `members_select` policy blocks them from reading back the inserted row. PostgREST surfaces that as an RLS error on the INSERT, masking whether the INSERT itself succeeded. The test inserts without a return value and verifies via direct psql query.

---

## Group 3 — `app_metadata.member_id` (Service Layer)

| # | What is tested | How | Expected |
|---|---|---|---|
| 3.1 | `completeRegistration()` service returns `memberId` | Call service directly with valid token and PENDING invitation | `memberId` present in result, `role` correct |
| 3.2 | `app_metadata.member_id` actually set on the Auth user | `getUserById` via service-role client after 3.1 | `app_metadata.member_id` matches the returned `memberId` |

---

## Group 4 — Regression

| # | What is tested | How | Expected |
|---|---|---|---|
| 4.1 | Formation tests unaffected by members schema change | Run `test-fp29-30-43-formation.ts` | 17/17 PASS |

---

## Key Design Decisions

- **`auth.uid()` as sole identity proof:** `complete_registration()` finds the PENDING invitation via `auth_user_id = auth.uid()` — the caller submits no tenant, role, or group info. These are sourced entirely from the invitation row.
- **`FOR UPDATE` on invitation row:** Serializes concurrent registration attempts for the same invite link; only one can mark the status ACCEPTED.
- **`SECURITY DEFINER`:** Bypasses RLS for the atomic multi-table write (members + assignments + invitations + audit_logs). Defense-in-depth RLS INSERT policy on `members` mirrors the function's own check for belt-and-suspenders.
- **Two-step app_metadata:** After the RPC, the service-role client calls `updateUserById` to write `member_id` into `app_metadata`. The member row exists at this point, so a failure here is an orphaned-metadata issue, not a data-integrity issue — caught by `METADATA_WRITE_FAILED` error code.
- **`redirectTo` in invite:** Route handler derives origin from `new URL(req.url).origin` and passes `${origin}/register/set-password` so invite links land at the correct page.
- **`setSession()` vs `signInWithPassword()` — email confirmation gate:** The real set-password page uses `supabase.auth.setSession({ access_token, refresh_token })` with tokens Supabase issues as part of the invite link. `setSession` decodes the JWT locally, checks expiry, and either uses the token directly or calls `_callRefreshToken` — there is no email confirmation check in this path (confirmed by review of `@supabase/auth-js` GoTrueClient source). The `email_not_confirmed` error code lives exclusively in `signInWithPassword`, which is why test harness users need `email_confirm: true` before calling `signInWithPassword` to simulate "has a session". Real registrants clicking their invite link never go through `signInWithPassword` and are never blocked by the confirmation gate.
