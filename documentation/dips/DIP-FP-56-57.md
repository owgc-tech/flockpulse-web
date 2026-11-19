DIP-FP-56-FP-57 — Admin Views Invitations and Revokes a Pending Invitation
Covers: FP-56 (Admin Views Pending/Accepted/Revoked Invitations), FP-57 (Admin Revokes a Pending Invitation) Epic: FP-8 (EPIC-2 — Member & Group Management)
Story Summary
One Admin-facing screen: a table of every invitation sent for the tenant (pending/accepted/revoked, filterable), with a revoke action available only on `PENDING` rows. FP-56 is pure read; FP-57 is the one write path on that same screen. Combined because they're structurally the same UI surface, not two separate screens.
Repo Target
Web — `owgc-tech/flockpulse-web`, working branch `dev`.
Grounding Check

1. No local tool access this session to re-verify current file/schema state before drafting — CC must confirm everything below against the real, current codebase before implementing. In particular: confirm the exact shape of `src/features/invitations/invitation.service.ts` and `.repository.ts` as they actually landed after FP-54's fixes (the `redirectTo` addition, the two RLS-related migration corrections) — do not draft against this DIP's memory of FP-54's original state.
2. Revoke must delete the Supabase Auth user before updating the database, not after — this ordering is a deliberate security decision, not incidental. Reasoning: if the DB update (mark `REVOKED` + audit log) happened first and the subsequent `deleteUser()` call failed, the invitation would show `REVOKED` in our own table while the underlying Auth credential still exists — meaning a registrant could still complete registration via a stale link despite the invite appearing revoked. That's a real security-adjacent gap. Deleting the Auth user first means the worst-case failure mode is the safe direction: the DB update fails, the invitation row is stuck showing `PENDING` even though the credential is already gone, which blocks registration rather than silently permitting it. This is worth being explicit about, not left as an implementation detail someone could reorder without realizing why it matters.
3. The DB-side update (status → `REVOKED` + audit log write) should be one atomic `SECURITY DEFINER` function, following the same "one function, one transaction" discipline as every other multi-effect write this session — not two separate service-role calls. This function should re-verify `status = 'PENDING'` itself with `FOR UPDATE` (same race-prevention pattern as `resolve_leader_confirmation()` and `complete_registration()`), not rely solely on an earlier check in the route/service layer — a second Admin racing to revoke the same invitation, or the registrant completing registration in the narrow window between check and action, are both real scenarios this guards against.
4. `GET /api/invitations` needs to resolve `group_id` → group name and `invited_by` → inviter name for display — confirm the cleanest way to do this against the actual schema rather than assuming a specific Supabase query pattern. Both are genuine FKs (`invitations.group_id → groups(id)`, `invitations.invited_by → members(id)`), so a PostgREST embed may work cleanly — but this session has hit embed ambiguity issues before (see FP-49/50 era notes on embed limitations). Verify directly rather than assume; a plain two-step resolution (fetch invitations, then a small lookup map for the referenced groups/members) is an acceptable, simpler fallback if the embed proves awkward.
5. Revoke is Admin-only and scoped to `PENDING` rows only — an `ACCEPTED` invitation cannot be revoked through this action. Revoking an accepted invitation would mean deleting an active member's login, a fundamentally different and more consequential action, explicitly out of scope per FP-57's own AC. The function should reject with a clear error if called against a non-`PENDING` row, not silently no-op.
6. Audit log entry: `entity_type = 'invitation'`, `action = 'revoke'`, `entity_id` = the invitation's own id, `actor_id` = the revoking Admin's member id. This directly closes the gap that was the deciding factor in building the `invitations` table in the first place (per FP-57's own Source note) — don't skip it now that the infrastructure exists.
7. No conflicts with Section 4 invariants. Additive RBAC unaffected; this is Admin-only visibility and a narrowly-scoped destructive action on a table that's already fully Admin-gated.
Implementation Plan

1. Migration — `revoke_invitation()` atomic function:
sql

```sql
   CREATE OR REPLACE FUNCTION public.revoke_invitation(
       p_invitation_id UUID,
       p_admin_member_id UUID
   )
   RETURNS TABLE (invitation_id UUID, status TEXT)
   LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = public, pg_catalog
   AS $$
   DECLARE
       v_invitation invitations%ROWTYPE;
   BEGIN
       SELECT * INTO v_invitation
       FROM invitations
       WHERE id = p_invitation_id
       FOR UPDATE;

       IF NOT FOUND THEN
           RAISE EXCEPTION 'Invitation not found';
       END IF;

       IF v_invitation.status <> 'PENDING' THEN
           RAISE EXCEPTION 'Only PENDING invitations can be revoked (current status: %)', v_invitation.status;
       END IF;

       UPDATE invitations
       SET status = 'REVOKED', responded_at = now()
       WHERE id = p_invitation_id;

       PERFORM write_audit_log(
           v_invitation.tenant_id, 'invitation', v_invitation.id, 'revoke',
           p_admin_member_id, to_jsonb(v_invitation), NULL
       );

       RETURN QUERY SELECT v_invitation.id, 'REVOKED'::TEXT;
   END;
   $$;
```

Note: this function only handles the DB-side status/audit update — it does not call `deleteUser()`, which requires the Admin API and must happen in the application layer, called by the service function before this RPC, per Grounding Check item 2.

1. `revokeInvitation(tenantId, adminMemberId, invitationId)` service function, sequence matters:
   * Fetch the invitation (confirm tenant match, confirm `status = 'PENDING'`) — early check for a fast, clear error, not the sole guard (the SQL function re-checks).
   * Call `serviceClient().auth.admin.deleteUser(invitation.auth_user_id)` — first.
   * If that succeeds, call `revoke_invitation()` RPC to update status + write audit log.
   * If `deleteUser()` itself fails, stop — do not proceed to the DB update, surface the error clearly.
2. `GET /api/invitations` — extend the existing `listInvitations()` repository function (or add a new one) to resolve group name and inviter name per Grounding Check item 4. Admin-only, tenant-scoped, matches the existing route pattern from FP-54's `POST /api/invitations`.
3. `POST /api/invitations/[id]/revoke` (Admin-only): calls the service function above.
4. Web UI: single screen — table of invitations (email, role, group name, status, inviter name, invited_at, responded_at), filterable by status, with a Revoke action/button visible only on `PENDING` rows.
5. Regression check: confirm nothing in FP-54/55's existing flows is affected — this DIP only adds new read/write surface, doesn't modify `inviteMember()` or `complete_registration()`.
Files to Create/Modify

* New migration file (confirm actual current head before assuming a specific number — should be `000021` if nothing else has landed since `000020`)
* `src/features/invitations/invitation.repository.ts` (modify — extend list query, add revoke-related reads)
* `src/features/invitations/invitation.service.ts` (modify — add `revokeInvitation()`)
* `app/api/invitations/route.ts` (modify — extend `GET` handler)
* `app/api/invitations/[id]/revoke/route.ts` (new)
* Admin Invitations screen (new) — likely `app/admin/invitations/page.tsx` + supporting components, matching the established Server Component / Client Component / Server Action pattern from FP-54/55
* `documentation/test-plans/FP-56-57-invitations-checklist.md`
Branch Name
`feature/FP-56-57-invitations-view-revoke`
Commit Message
`FP-56, FP-57: Admin views invitations and revokes pending invitations`
Pull Request Description
Maps to both stories' ACs: list endpoint with resolved group/inviter names and status filtering, revoke action scoped to `PENDING` only, Auth-user-deleted-before-DB-updated ordering explicitly confirmed and reasoned about in the PR description, audit log entry confirmed present via direct query (not just "the call didn't error").
Jira Linkage

* PDEEpicID: FP-8 (EPIC-2 — Member & Group Management)
* PDEStoryID: FP-56, FP-57
Stop Point
Save this DIP verbatim to `documentation/dips/DIP-FP-56-57.md` and do not append executor notes after the initial save. Executor observations belong exclusively in the PR description.
Before writing any code: verify current schema/migration head, confirm FP-54's actual shipped shape (including its two post-review fixes), and confirm the cleanest way to resolve group/inviter names for the list endpoint.
If any Jira ticket needs to be filed for a finding during this DIP, do not file it directly — report it back for Atlas to file.
All changes go through a feature branch and a PR — no direct pushes to `dev`, no exceptions.
Create the feature branch, implement, test (including direct verification that the `deleteUser`-then-`revoke_invitation()` ordering is actually what's implemented, that revoking a non-`PENDING` invitation is correctly rejected, and that the audit log entry is genuinely present with correct `before_value`/`after_value` — not just "the call didn't error"), commit, push, and open the PR against `dev`. Do not merge — the user will test locally and merge manually.
Include full diffs for every file in your completion report — not a summary.
