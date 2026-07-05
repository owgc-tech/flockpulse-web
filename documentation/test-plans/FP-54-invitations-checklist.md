# FP-54 — Admin Invites a New Member

Branch: `feature/FP-54-invite-member`
Migration: `20260629000019_invitations.sql`
Date: 2026-07-05
Tester: CC (manual DB inspection + Auth Admin API inspection)

---

### Grounding check findings (executor)

`inviteUserByEmail(email, { data: ... })` maps `data` to `user_metadata`, not `app_metadata`. The DIP's stated intent (metadata in `app_metadata`, server-controlled and not user-editable) is correct; the description of how to get it there was not — a single-call assumption in the DIP body doesn't match the installed SDK (`@supabase/supabase-js@2.108.2`). Confirmed against `GoTrueAdminApi.d.ts`: `data` → `user_metadata`, `app_metadata` requires `updateUserById`. Service uses a two-step pattern: `inviteUserByEmail` to create the pending Auth user, then immediately `updateUserById` to write `app_metadata`. If the metadata write fails, the Auth user is deleted before throwing — no dangling Auth user with missing tenant binding.

---

### Group 1 — Schema / migration correctness (scripts/test-fp54-invitations.ts)

| # | Check | Result |
|---|-------|--------|
| 1.1 | `invitations` table created with all 10 required columns | PASS |
| 1.2 | `role` CHECK constraint rejects invalid values | PASS |
| 1.3 | `status` CHECK constraint rejects invalid values | PASS |
| 1.4 | Unique partial index `idx_invitations_unique_pending_email` blocks second PENDING invite for same `(tenant_id, email)` | PASS |
| 1.5 | Cross-tenant group_id trigger fires: group from wrong tenant rejected with custom message | PASS |
| 1.6 | `null` group_id (no group assigned) accepted cleanly | PASS |

### Group 2 — Auth + app_metadata (scripts/test-fp54-invitations.ts)

| # | Check | Result |
|---|-------|--------|
| 2.1 | `inviteUserByEmail` creates a pending Auth user and returns its ID | PASS |
| 2.2 | `updateUserById` writes `tenant_id`/`role`/`group_id` to `app_metadata` without error | PASS |
| 2.3 | Direct Admin API read via `getUserById` confirms correct values in `app_metadata` — not just "no error" | PASS |

Test 2.3 is the security-critical one: confirms the three FP-55-critical fields (`tenant_id`, `role`, `group_id`) are actually present in `app_metadata` on the Auth user object, with the exact UUIDs passed at invite time.

### Group 3 — inviteMember service (scripts/test-fp54-invitations.ts)

| # | Check | Result |
|---|-------|--------|
| 3.1 | `inviteMember()` creates invitation row AND Auth user with correct `app_metadata` | PASS |
| 3.2 | Second `inviteMember()` call for same email raises `DUPLICATE_INVITE` | PASS |
| 3.3 | No invitation row left behind if Auth invite step fails | PASS |

### Group 4 — Regression

| Script | Tests | Result |
|--------|-------|--------|
| `test-fp29-30-43-formation.ts` | 17/17 | PASS |

---

### Design decisions

- Two-step Auth pattern: `inviteUserByEmail` then `updateUserById` for `app_metadata` — required by SDK design, not a choice. `data` on `inviteUserByEmail` goes to `user_metadata` (user-writable); `app_metadata` is Admin-API-only.
- Cleanup on metadata write failure: `deleteUser` called before re-throwing — no orphaned Auth users with missing tenant binding.
- `invited_by` references `members(id)` (not `auth.users`) — consistent with the rest of the schema; every actor reference is a member ID.
- Unique partial index on `(tenant_id, email) WHERE status = 'PENDING'` — allows re-inviting the same email after a prior invite was ACCEPTED or REVOKED, which is the correct behavior (e.g. role change, membership lapse).
- `group_id` nullable with `ON DELETE SET NULL` — group deletion should not break invitation history.
- No hard-delete path on invitations — consistent with standing rule from migration 000003.
