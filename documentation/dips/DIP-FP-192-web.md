### Story Summary
Replaces the hardcoded 7-option role dropdown (Member / Pastoral Leader / Leader / Community Servant / Coordinator / Sr. Coordinator / Admin) with a tenant-owned `role_catalog` table. For OWGC, nothing changes visually or behaviorally — the catalog is seeded with those exact 7 names in that exact order, so the dropdown looks identical. What changes is that a tenant can now add its own named entries (any name, any of the three tiers) without a code deploy. `members.role`/`invitations.role` and every existing RBAC check (`ROLE_HIERARCHY`, `caller_is_admin()`, `caller_member_is_leader_or_admin()`, the CHECK constraints) are completely untouched — this is a display layer, not a new access model. Deleting a catalog entry that's still assigned to anyone is blocked with a reason and count; the admin bulk-reassigns those members/invitations to a different same-tier entry to "unuse" it before delete succeeds.

### Repo Target
Web (Next.js) — schema, migration, admin CRUD/reassign UI, and every current display/selection site. A follow-up mobile DIP (not written here, blocked on this one shipping) swaps mobile `Avatar.tsx`'s duplicate hardcoded label map for a resolved `role_display_name` field this DIP adds to member-returning API responses.

### Grounding Check
Re-confirmed live against `owgc-tech/flockpulse-web` `dev`, this session:
- `MemberEditForm.tsx` and `InviteForm.tsx` both have the identical 7-option list, same order, same values — this is the exact seed set, not an approximation.
- `members.role`/`invitations.role` CHECK constraints and `ROLE_HIERARCHY` (middleware.ts) remain exactly as documented earlier this session — `'ADMIN'`, `'LEADER'`, `'MEMBER'` are already legal values and already rank correctly, which is what makes the no-RLS-touch design work: going forward, any catalog-driven role write sets `role` to the entry's generic tier value (`'ADMIN'`/`'LEADER'`/`'MEMBER'`), never the specific literal. Existing members keep their current specific literal (`PASTORAL_LEADER`, `SR_COORDINATOR`, etc.) untouched unless/until an admin re-saves their profile, at which point it silently normalizes to the generic tier value — functionally identical for RBAC (they already rank identically), purely an internal consolidation. Worth knowing about, not a concern.
- `tasks` table (`20260719000051_task_foundation.sql`) is the schema precedent: `{id, tenant_id, name, deleted_at, created_at, updated_at}` + unique partial index `(tenant_id, name) WHERE deleted_at IS NULL`.
- `softDeleteMember()`'s Pastoral Leader guard (`members/service.ts:267`) is the precedent for the delete-block: `P0001` + message substring → `INVALID_STATE_TRANSITION` with a parsed count.
- `BulkReassignForm.tsx` is the UX precedent for the reassign-before-delete flow.
- Cross-tenant referential safety (Section 5.4): `role_catalog_entry_id` on both `members` and `invitations` needs a trigger confirming the referenced `role_catalog` row's `tenant_id` matches.
- Atomic multi-table writes (Section 5.5): the bulk-reassign action writes both `members` and `invitations` in one logical operation — implemented as a single `SECURITY DEFINER` RPC, not two client-side calls.
- `registration.service.ts:92` (`role: row.role`) is where the new `role_catalog_entry_id` copy-through belongs, alongside the existing `role` copy.
- A catalog entry's `tier` is set once at creation and is not editable afterward — only its `name` can be renamed. Letting tier change out from under members already assigned to it would be a silent RBAC change wearing a rename's clothing; if a tenant needs a title moved to a different tier, the right move is delete-and-recreate (which the block/reassign flow already handles safely), not an in-place tier edit.

### Implementation Plan
1. **Migration**: `role_catalog` table (mirrors `tasks` + `tier TEXT NOT NULL CHECK (tier IN ('ADMIN','LEADER','MEMBER'))`, tier immutable after creation by convention — enforced at the service layer, not a DB trigger, since it's a business rule about *when* editing is allowed, not a data-integrity invariant); `role_catalog_entry_id UUID REFERENCES role_catalog(id)` on both `members` and `invitations`; cross-tenant safety trigger on both; delete-block trigger on `role_catalog` (mirrors the Pastoral Leader guard's exact message-with-count convention, checking active `members` and pending `invitations`).
2. **Seed**: exactly the 7 rows above, per existing tenant, verbatim names/order/tiers.
3. **Backfill**: every existing `members`/pending `invitations` row's `role_catalog_entry_id` set from its current literal `role`, matched to the seeded row of the same name — no change to the `role` column itself during backfill.
4. **`role-catalog.repository.ts`/`.service.ts`**: list (grouped by tier), create, rename, soft-delete (catches the trigger's `P0001` → `INVALID_STATE_TRANSITION` + parsed count, same as `softDeleteMember`).
5. **New RPC**: `reassign_role_catalog_entry(p_from_entry_id, p_to_entry_id, p_tenant_id)` — atomically moves every `members`/`invitations` row off entry A onto entry B (same tier only, validated inside the function), single transaction.
6. **New routes**: `GET/POST /api/role-catalog`, `PATCH /api/role-catalog/[id]` (rename or soft-delete), `POST /api/role-catalog/[id]/reassign`.
7. **New admin UI**: `app/admin/(shell)/roles/page.tsx` (mirrors `tasks/page.tsx`'s location) — list grouped by tier, add/rename/delete; a blocked delete shows the reason + count inline with a link to `app/admin/(shell)/roles/[id]/reassign/page.tsx` (mirrors `BulkReassignForm.tsx`).
8. **`MemberEditForm.tsx`/`InviteForm.tsx`**: the 7 hardcoded `<option>` tags become a fetch of the tenant's `role_catalog`, same visual grouping/order. Submitting sends the picked `role_catalog_entry_id`; the server (not the client) derives and writes the generic tier `role` value alongside it.
9. **`roleLabels.ts`, `UserAvatarMenu.tsx`, `MembersTable.tsx`, `InvitationsTable.tsx`**: read the resolved catalog name via the member/invitation's `role_catalog_entry_id`, falling back to the existing `ROLE_LABELS[role]` map only if the FK is unexpectedly null (defensive, not the normal path).
10. **`registration.service.ts`**: copy `role_catalog_entry_id` from invitation to member at acceptance, alongside the existing `role` copy.
11. Add a resolved `role_display_name` field to member-returning API payloads mobile consumes, for the follow-up mobile DIP.

### Files to Create/Modify
- New migration in `supabase/migrations/`
- `src/features/role-catalog/role-catalog.repository.ts`, `.service.ts` (new)
- `app/api/role-catalog/route.ts`, `app/api/role-catalog/[id]/route.ts`, `app/api/role-catalog/[id]/reassign/route.ts` (new)
- `app/admin/(shell)/roles/page.tsx`, `app/admin/(shell)/roles/[id]/reassign/page.tsx` (new)
- `src/lib/auth/roleLabels.ts`, `UserAvatarMenu.tsx`, `MembersTable.tsx`, `InvitationsTable.tsx`, `MemberEditForm.tsx`, `InviteForm.tsx` (modify)
- `src/features/registration/registration.service.ts` (modify)

### Branch Name
feature/FP-192-web-role-catalog

### Commit Message
FP-192-web: tenant-configurable role catalog for all three access tiers

### Pull Request Description
Maps to FP-192's acceptance criteria: new tenant-scoped catalog (name + tier), seeded verbatim from today's hardcoded 7 options so no tenant's dropdown or displayed titles change on cutover, Admin-facing add/rename/delete UI, delete blocked with reason+count while in use with a bulk-reassign path to clear the block, every existing role-display site reading from the catalog instead of the hardcoded map. `members.role`/`invitations.role` and all RLS/middleware RBAC logic are unchanged — new writes consolidate onto the three generic tier values, existing rows are untouched.

### Jira Linkage
- PDEEpicID: FP-8
- PDEStoryID: FP-192

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-192-web.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against dev and stop. Do not merge — the user will check out the branch locally, test it against the deployed dev environment, and merge manually.

Include full diffs for every file in your completion report per Section 5, rule 12 — not a summary.
