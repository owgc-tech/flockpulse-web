# FP-56 / FP-57 — Admin Views Invitations & Revokes a Pending Invitation

## Scope

| Ticket | Title |
|--------|-------|
| FP-56  | Admin Views Invitations |
| FP-57  | Admin Revokes a Pending Invitation |

---

## Deliverables

| # | Artefact | Path |
|---|----------|------|
| 1 | Migration — `revoke_invitation()` function | `supabase/migrations/20260629000021_revoke_invitation.sql` |
| 2 | Repository — `listInvitationsWithNames`, `getInvitationById` | `src/features/invitations/invitation.repository.ts` |
| 3 | Service — `listInvitations`, `revokeInvitation` | `src/features/invitations/invitation.service.ts` |
| 4 | Types — `InvitationDisplayRow` | `src/features/invitations/invitation.types.ts` |
| 5 | GET `/api/invitations` route | `app/api/invitations/route.ts` |
| 6 | POST `/api/invitations/[id]/revoke` route | `app/api/invitations/[id]/revoke/route.ts` |
| 7 | Admin Invitations page (Server Component) | `app/admin/invitations/page.tsx` |
| 8 | InvitationsTable (Client Component) | `app/admin/invitations/InvitationsTable.tsx` |

---

## Test Results — 13/13 PASSED

### Group 1 — Migration / Schema (SQL-level via psql)

| ID  | Description | Expected | Result |
|-----|-------------|----------|--------|
| 1.1 | `revoke_invitation()` function exists in public schema | present | ✅ PASS |
| 1.2 | Call with unknown `id` → raises `Invitation not found` | exception | ✅ PASS |
| 1.3 | Call on ACCEPTED invitation → raises `Only PENDING invitations can be revoked` | exception | ✅ PASS |
| 1.4 | Call on PENDING invitation → returns `{ status: REVOKED }` | REVOKED row returned | ✅ PASS |
| 1.5 | Audit log written: `entity_type=invitation`, `action=revoke`, `before_value` present, `after_value=null` | audit row present | ✅ PASS |

### Group 2 — `GET /api/invitations` (HTTP via real `next dev`)

Tests run against a spawned `next dev` process with env vars injected. The real `requireRole('ADMIN')` gate and `?status=` query-param parsing/filtering code path are exercised end-to-end.

| ID  | Description | Expected | Result |
|-----|-------------|----------|--------|
| 2.1 | Admin token → 200, rows returned with resolved `inviter_name` (not raw UUID) | 200, name string | ✅ PASS |
| 2.2 | `?status=PENDING` filter returns only PENDING rows; REVOKED/ACCEPTED rows excluded; live PENDING row present | rows ≥ 1, all PENDING | ✅ PASS |
| 2.3 | MEMBER token → 403 `FORBIDDEN_ROLE` | 403 | ✅ PASS |

### Group 3 — `revokeInvitation()` Service Layer

| ID  | Description | Expected | Result |
|-----|-------------|----------|--------|
| 3.1 | Call on ACCEPTED invitation → `NOT_PENDING` error code, no Auth mutation | error before deleteUser | ✅ PASS |
| 3.2 | Call on PENDING: `deleteUser` executes first, then DB row updated to REVOKED | auth user absent + DB REVOKED | ✅ PASS |
| 3.3 | Audit log: `before_value.status=PENDING`, `after_value=null`, correct `actor_id` | audit row present | ✅ PASS |
| 3.4 | Second call (now REVOKED) → `NOT_PENDING` replay blocked | error | ✅ PASS |

### Group 4 — Regression

| ID  | Description | Expected | Result |
|-----|-------------|----------|--------|
| 4.1 | `inviteMember()` (FP-54 path) still works after this DIP's changes | PENDING invitation created | ✅ PASS |

---

## Key Design Decisions

**`deleteUser` before DB update (fail-safe ordering)**  
If `revoke_invitation()` RPC fails after `deleteUser` succeeds, the invitation row stays PENDING but the Auth credential is gone — registration is blocked but the REVOKED state is not falsely shown. The reverse ordering (DB update first) risks showing REVOKED while the Auth credential still exists and the link could still be followed.

**`FOR UPDATE` on invitation row in `revoke_invitation()`**  
Serialises concurrent revoke calls. If two admin requests race, the second sees the updated row status (`<> 'PENDING'`) and raises `Only PENDING invitations can be revoked`.

**Two-step name resolution in `listInvitationsWithNames`**  
Avoids PostgREST embed ambiguity on multiple FK paths between `invitations` and `members`/`groups`. Fetches invitations first, then builds group/member lookup maps via `IN` queries.
