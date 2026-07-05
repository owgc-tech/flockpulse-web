# FP-101 — Founder Self-Registration (New Tenant + Founding Admin)

## Scope

| Ticket | Title |
|--------|-------|
| FP-101 | Founder Self-Registration — New Tenant + Founding Admin |

---

## Grounding findings (confirmed before implementation)

| Item | Finding |
|------|---------|
| `tenants` schema | `id, name, created_at` at creation; `attendance_window_hours INTEGER NOT NULL DEFAULT 24` added in migration 000005. INSERT with only `name` applies the default. |
| Email confirmation | `enable_confirmations = false` in `supabase/config.toml`. `signUp()` returns a session immediately — no email-confirmation redirect step for local dev. For production environments with `enable_confirmations = true`, the `signUp()` call returns `session = null` and the form surfaces a message instructing the founder to check their inbox. No separate landing page was built because the local config does not exercise that path; the form handles the `session = null` case inline. If email confirmation is enabled in production, a dedicated confirmation-landing page will be needed (flagged for FP-102 / future work). |
| Confirmation link shape | Moot for current config. The FP-55 invite path uses `#access_token=...&refresh_token=...&type=invite` in the URL hash. If `signUp()` confirmation links ever become relevant, verify whether they use the same hash mechanism or PKCE `?code=` before building a landing page. |
| `get_tenant_members()` | Does not exist. No such function in any migration. |
| Next migration number | 000022 (confirmed by listing `supabase/migrations/`). |

---

## Deliverables

| # | Artefact | Path |
|---|----------|------|
| 1 | Migration — `create_tenant_and_founding_admin()` | `supabase/migrations/20260705000022_founder_registration.sql` |
| 2 | Types | `src/features/founder-registration/founder-registration.types.ts` |
| 3 | Service | `src/features/founder-registration/founder-registration.service.ts` |
| 4 | Registration page (Server Component) | `app/register/founder/page.tsx` |
| 5 | Registration form (Client Component) | `app/register/founder/FounderRegistrationForm.tsx` |

---

## Test Results — 9/9 PASSED

### Group 1 — Migration / Schema

| ID  | Description | Expected | Result |
|-----|-------------|----------|--------|
| 1.1 | `create_tenant_and_founding_admin()` function exists in public schema | present | ✅ PASS |
| 1.2 | Unauthenticated caller (anon key, no user JWT) → blocked | PGRST301 or 42501 | ✅ PASS |
| 1.3 | Authenticated call creates tenant + member rows; member role = ADMIN | both rows present | ✅ PASS |
| 1.4 | Second call with same Auth user → `already registered` exception | exception | ✅ PASS |
| 1.5 | Created tenant's `attendance_window_hours` = 24 (column default, not hardcoded) | 24 | ✅ PASS |
| 1.6 | Both audit entries present: `entity_type=tenant/action=create` and `entity_type=member/action=register`; both `actor_id = member_id`; `before_value = null`, `after_value` present | both rows | ✅ PASS |

### Group 2 — `createTenantAndFoundingAdmin()` Service Layer

| ID  | Description | Expected | Result |
|-----|-------------|----------|--------|
| 2.1 | Happy path: tenant row name correct, member role = ADMIN, `app_metadata` verified via `getUserById` — `tenant_id`, `role = 'ADMIN'`, `member_id` all correct | correct meta | ✅ PASS |
| 2.2 | Duplicate call with same Auth user → `ALREADY_REGISTERED` error code | error code | ✅ PASS |

### Group 3 — Regression

| ID  | Description | Expected | Result |
|-----|-------------|----------|--------|
| 3.1 | `inviteMember()` (FP-54 path) still works; this is new parallel surface area, not a modification of the invite flow | PENDING invitation created | ✅ PASS |

---

## Key Design Decisions

**`attendance_window_hours` not passed to INSERT**
The column has `DEFAULT 24` in the schema (migration 000005). The `create_tenant_and_founding_admin()` function omits it from the `INSERT` statement intentionally, letting the column default apply rather than duplicating the value in SQL code.

**Audit log actor_id uses `v_member_id` for both entries**
Both the tenant and member audit entries use the founding member's ID as `actor_id`. The tenant audit entry is written *after* the member INSERT precisely so `v_member_id` is available — the founding admin is both the subject and the actor of this operation.

**`enable_confirmations = false` — no confirmation landing page**
For the current local config, `signUp()` returns a session immediately. The form completes the entire flow inline: signUp → RPC → app_metadata → refreshSession → redirect. The `session = null` path (for production envs with confirmations enabled) is handled inline in the form with a message. A dedicated confirmation-landing page is flagged as future work if confirmations are enabled in production.

**Redirect to `/login` after completion**
Per DIP Grounding Check item 7: this flow does not establish a persistent session (no cookie-based session mechanics yet — that belongs to FP-102). The founder is redirected to `/login` to authenticate fresh with their confirmed credentials.
