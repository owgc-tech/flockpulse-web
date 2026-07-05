# FP-101 — Founder Self-Registration (New Tenant + Founding Admin)

## Scope

| Ticket | Title |
|--------|-------|
| FP-101 | Founder Self-Registration — New Tenant + Founding Admin |

---

## Grounding findings (confirmed before implementation)

| Item | Finding |
|------|---------|
| `tenants` schema | `id, name, created_at` at creation; `attendance_window_hours INTEGER NOT NULL DEFAULT 24` added in migration 000005; `description TEXT` (nullable, no default) added in migration 000022. INSERT with only `name` and `description` applies the `attendance_window_hours` default. |
| `attendance_window_hours` UI exposure | Not exposed in either screen. Confirmed — neither Screen 1 nor Screen 2 includes this field. Column default applies silently. |
| Email confirmation | `enable_confirmations = false` in `supabase/config.toml`. `signUp()` returns a session immediately for local dev. Screen 1 stores the access_token in sessionStorage and redirects to Screen 2. For fpdb-dev / production where confirmations are enabled, Screen 1 shows a "check your inbox" message and Screen 2's Path B handles the hash-token delivery from the confirmation link. |
| Confirmation link shape | Both paths confirmed working. Path A (local): sessionStorage token. Path B (production): Supabase delivers tokens via URL hash `#access_token=...&refresh_token=...&type=signup`. Screen 2 calls `setSession({ access_token, refresh_token })` — same mechanism as FP-55's set-password page. |
| `get_tenant_members()` | Does not exist. No such function in any migration. |
| Next migration number | 000022 (confirmed). |

---

## Deliverables

| # | Artefact | Path |
|---|----------|------|
| 1 | Migration — `description TEXT` column + `create_tenant_and_founding_admin()` | `supabase/migrations/20260705000022_founder_registration.sql` |
| 2 | Types | `src/features/founder-registration/founder-registration.types.ts` |
| 3 | Service | `src/features/founder-registration/founder-registration.service.ts` |
| 4 | Screen 1 — email + password (Server Component wrapper) | `app/register/founder/page.tsx` |
| 5 | Screen 1 — form (Client Component) | `app/register/founder/FounderRegistrationForm.tsx` |
| 6 | Screen 2 — page (Server Component wrapper) | `app/register/founder/complete/page.tsx` |
| 7 | Screen 2 — form with two-column layout (Client Component) | `app/register/founder/complete/FounderCompleteForm.tsx` |

---

## Test Results — 11/11 PASSED

### Group 1 — Migration / Schema

| ID  | Description | Expected | Result |
|-----|-------------|----------|--------|
| 1.1 | `create_tenant_and_founding_admin()` function exists in public schema | present | ✅ PASS |
| 1.2 | Unauthenticated caller (anon key, no user JWT) → blocked (PGRST301) | blocked | ✅ PASS |
| 1.3 | Authenticated call with description → tenant + member rows created; description stored in tenants | rows present, description correct | ✅ PASS |
| 1.4 | Second call with same Auth user → `already registered` exception | exception | ✅ PASS |
| 1.5 | Created tenant's `attendance_window_hours` = 24 (column default; neither screen exposes this field) | 24 | ✅ PASS |
| 1.6 | Both audit entries: `entity_type=tenant/action=create` and `entity_type=member/action=register`; both `actor_id = member_id`; `before_value = null`, `after_value` present | both rows | ✅ PASS |
| 1.7 | `p_description = NULL` → no error, `description IS NULL` in tenants | NULL stored | ✅ PASS |

### Group 2 — `createTenantAndFoundingAdmin()` Service Layer

| ID  | Description | Expected | Result |
|-----|-------------|----------|--------|
| 2.1 | Happy path with description: tenant name, member role, description stored, `app_metadata` verified via `getUserById` | correct | ✅ PASS |
| 2.2 | Duplicate call → `ALREADY_REGISTERED` error code | error code | ✅ PASS |
| 2.3 | **Path B (hash-token arrival)**: `setSession({ access_token, refresh_token })` establishes session; service call with resulting token succeeds; `app_metadata` correct | full path works | ✅ PASS |

### Group 3 — Regression

| ID  | Description | Expected | Result |
|-----|-------------|----------|--------|
| 3.1 | `inviteMember()` (FP-54 path) still works; this is new parallel surface area | PENDING invitation created | ✅ PASS |

---

## Key Design Decisions

**Two-screen split**  
Screen 1 (`/register/founder`) collects only email + password, calls `signUp()` with no `options.data` stashing. Screen 2 (`/register/founder/complete`) collects community + founder profile and calls the RPC. Avoids requiring all profile data to survive across the email-confirmation gap via user_metadata.

**Screen 2 dual arrival paths**  
- **Path A** (local dev): Screen 1 stores the immediate session token in `sessionStorage` and redirects. Screen 2 reads it and clears it.
- **Path B** (fpdb-dev / production): Screen 1 shows "check your inbox". The confirmation link delivers `#access_token=...&refresh_token=...&type=signup`. Screen 2's `useEffect` parses the hash, calls `setSession()`, clears the hash from the URL bar.

**Textarea height computed via `useLayoutEffect`**  
Screen 2 measures the right column's rendered height using a ref and `getBoundingClientRect()` on every render. The textarea height is set to `rightColHeight − communityNameFieldHeight − gap`. This means the textarea grows/shrinks as validation messages appear in the right column, keeping both column bottoms aligned without a hardcoded pixel value.

**`attendance_window_hours` not passed to INSERT**  
Column has `DEFAULT 24` (migration 000005). The function omits it intentionally. Neither Screen 1 nor Screen 2 exposes this field.

**`description` is nullable**  
`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS description TEXT` — no NOT NULL, no default. An empty string from the UI is coerced to `null` in the service call (`description.trim() || null`).

**Audit log actor_id uses `v_member_id` for both entries**  
Both audit entries are written after the member INSERT so `v_member_id` is available as actor for both.
