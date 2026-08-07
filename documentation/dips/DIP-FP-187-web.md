### DIP 1 of 2 — Web

### Story Summary
Adds the backend half of self-service account deletion: a new `DELETE /api/members/me` endpoint that anonymizes the caller's own PII (never anyone else's — no target id accepted, everything derived from the caller's own JWT), sets `deleted_at` (reusing the exact same column transition the existing admin "Deactivate Member" flow uses, so its three existing guard triggers apply automatically), and then removes the person's Supabase Auth login entirely so they can't log back in post-deletion. Sole-Owner self-deletion is explicitly excluded from this DIP — deferred pending FP-172's tenant Owner role, per the story's confirmed scope.

### Repo Target
Web (Next.js) — backend/API work for a mobile-scoped story still belongs here, per this project's standing convention; only the UI is mobile's concern (DIP 2 of 2).

### Grounding Check
Confirmed live against `owgc-tech/flockpulse-web` `dev`:
- `softDeleteMember()` (`src/features/members/service.ts:311`) only sets `deleted_at` — no PII scrub, no `auth.users` involvement. This DIP is a genuinely new sibling function, not a small extension of that one.
- Its three existing `P0001` guard branches (Assigned Leader in use, group ownership, event ownership) are triggers on the `deleted_at` transition itself — they fire regardless of which code path sets it. Reused as-is, same error-mapping pattern, no new guard logic needed.
- `idx_members_unique_active_email_per_tenant` is `UNIQUE (tenant_id, email) WHERE deleted_at IS NULL` — a scrubbed/anonymized email on a `deleted_at IS NOT NULL` row can never collide with anything.
- Members table's actual PII columns, confirmed against the real migrations (not assumed from spec language): `email`, `first_name`, `last_name`, `gender`, `marital_status`, `birthdate`. No `phone` column exists. `role`/`role_catalog_entry_id` are not PII and are left untouched — the story's "historical associations retained" language applies to these too.
- `db.auth.admin.getUserById`/`updateUserById` are already used elsewhere in this same file (role-metadata sync) — same service-role client, same convention. `auth.admin.deleteUser` is new; nothing in this codebase calls it yet.
- Sequencing decision, stated explicitly rather than left implicit: scrub-and-deactivate the `members` row first, delete the `auth.users` identity second. If the auth deletion step fails, the person is still fully locked out (every API call already hits `deleted_at IS NULL` and 401s) and their app-visible PII is already gone — a stray `auth.users` row becomes a manual cleanup item, not a live privacy gap. Doing it in the other order would risk the reverse: auth identity gone, but PII still sitting in `members` if the scrub step then failed.
- No canonical error code fits an `auth.admin.deleteUser` failure after the DB half already succeeded — `AUTH_DELETE_FAILED` is a new code, not a duplicate of anything in Section 6 (Section 5.6 checked; nothing existing covers this specific partial-failure state).

### Implementation Plan
1. **`src/features/members/service.ts`**: new `deleteOwnAccount(userId, tenantId, memberId)`. Single `UPDATE members SET deleted_at = now(), email = 'deleted-' || id || '@deleted.invalid', first_name = 'Deleted', last_name = 'Member', gender = NULL, marital_status = NULL, birthdate = NULL WHERE id = memberId AND tenant_id = tenantId AND deleted_at IS NULL` (one atomic statement — scrub and deactivate together, not two writes). `.invalid` is the IANA-reserved TLD (RFC 2606) meant exactly for this kind of placeholder value. Catch the same three `P0001` guard branches `softDeleteMember` already handles, identical error mapping. On success, call `db.auth.admin.deleteUser(userId)`; if that fails, throw a new `AUTH_DELETE_FAILED` error (the DB half has already committed — this is a distinct, later failure, not a rollback-able one).
2. **New route `app/api/members/me/route.ts`**: `DELETE`, any authenticated role (this is self-service, not an admin action — no `requireRole('LEADER')` gate). Derives `userId`/`tenantId`/`memberId` entirely from `ctx` (the JWT), accepts no body, no target-id parameter of any kind — structurally impossible to delete anyone but yourself. Maps `NOT_FOUND_IN_TENANT` → 404, `INVALID_STATE_TRANSITION` → 409 (same shape as the existing deactivation guard responses, including the parsed count), `AUTH_DELETE_FAILED` → 500.

### Files to Create/Modify
- `src/features/members/service.ts` (modify)
- `app/api/members/me/route.ts` (new)

### Migration Files (if applicable)
None — no schema changes, this reuses existing columns and existing triggers exactly as they are.

### Branch Name
feature/FP-187-web-self-service-account-deletion

### Commit Message
FP-187-web: add self-service account deletion endpoint

### Pull Request Description
Maps to FP-187's acceptance criteria: `DELETE /api/members/me` scrubs the caller's own PII and deactivates their `members` row in one atomic statement, reusing the existing deactivation guard triggers (Assigned Leader, group/event ownership) so a member who still owns things is blocked with the same clear reason the admin-facing flow already gives. Deletes the Supabase Auth identity afterward so login is genuinely no longer possible. No target-id parameter anywhere — this endpoint can only ever act on the caller's own account. Sole-Owner self-deletion explicitly not handled here, per FP-187's confirmed scope (blocked on FP-172).

### Jira Linkage
- PDEEpicID: FP-170
- PDEStoryID: FP-187

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-187-web.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against dev and stop. Do not merge — the user will check out the branch locally, test it against the deployed dev environment, and merge manually.

Include full diffs for every file in your completion report per Section 5, rule 12 — not a summary.
