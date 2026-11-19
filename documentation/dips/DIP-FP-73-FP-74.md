Confirmed live — both `FP-73` and `FP-74` are To Do, parented under `FP-8`, matching the manifest. A few things surfaced while grounding this one that are worth flagging before the DIP itself:

1. Dependency on the still-unexecuted adj-1 fix: I drafted `DIP-FP-69-FP-72-adj-1.md` (Pastoral Leader restricted to `LEADER`/`ADMIN` roles) a few turns ago, but you never confirmed handing it to CC or running it. FP-73's Bulk Reassign picks an "incoming Leader" from the same pool `set_member_pastoral_leader()` already validates — if adj-1 hasn't landed, that pool is still "any active member," not just Leaders/Admins. CC needs to check this live before building the picker; I'm not assuming either state.
2. FP-74's exact error code: the story explicitly analogizes to FP-29 (Talks blocking deletion while an event still references them). I don't have FP-29's actual error code or enforcement layer (app-layer check vs. DB trigger) in front of me, and nothing in the canonical error list is a precise fit. Rather than inventing a new code, CC needs to grep FP-29's implementation live and reuse its exact code/pattern for consistency. I'm defaulting to `INVALID_STATE_TRANSITION` as the closest canonical fit only if FP-29 turns out to have invented its own code that doesn't generalize — otherwise, match FP-29 exactly.
3. Nice natural fit: FP-73's own AC says "no new assignment mechanism — same logic as a single reassignment, applied per affected member." That's a direct match for looping calls to the existing `set_member_pastoral_leader()` RPC from Group A — not reimplementing retire-old/insert-new logic a second time.
Story Summary
FP-74 blocks deactivating a member while they're still someone's assigned Pastoral Leader (`assignments`, `assignment_type = 'LEADER'`) — the guard explicitly deferred back in FP-72's Member Edit screen (`TODO(FP-74)` already sitting at that call site). FP-73 is the resolution mechanism the blocked state points to: an Admin picks an outgoing Leader and an incoming Leader, and every member currently assigned to the outgoing Leader gets moved to the incoming one in a single atomic batch — reusing the exact same per-member reassignment logic already shipped in Group A, just looped. These two are combined because FP-74's guard is meaningless without FP-73's resolution path to surface, and FP-73 only exists as a mechanism for FP-74's problem — Group C was scoped as one unit from the start for this reason (per the manifest's own Sprint 10 grouping decision).
Repo Target
Web (Next.js, `owgc-tech/flockpulse-web`). No mobile surface.
Grounding Check

* Both stories fetched live via Jira (`FP-73`, `FP-74`), status To Do, parent `FP-8`. FP-69/72 and FP-70/71 both confirmed merged and tested — Groups A and B are done.
* Reuse confirmed by design, not by re-verifying code this session (Atlas doesn't have live repo access — CC must re-confirm signatures before building): `set_member_pastoral_leader(p_member_id, p_leader_member_id, p_tenant_id, p_actor_member_id)` from Group A already does retire-old/insert-new atomically for one member, with `trigger_validate_assignment_tenant` firing automatically on the INSERT. Bulk reassign should call this exact function once per affected member inside a new wrapper function's loop — not reimplement the retire/insert logic a second time. This is a direct match for FP-73's own AC wording.
* Open dependency, must be checked live before building the picker: whether `DIP-FP-69-FP-72-adj-1` (restrict Pastoral Leader to `LEADER`/`ADMIN` roles) has actually been executed. If it has, the incoming-Leader dropdown should filter to that role set; if not, it stays "any active member," matching current live behavior. Do not assume either way — check `validate_assignment_tenant()`'s current body live.
* FP-74's error code and enforcement layer, unresolved pending a live check: the story explicitly analogizes to FP-29 (Talks blocking deletion while referenced). CC must grep FP-29's actual implementation (error code used, and whether the guard lives in a service-layer check or a DB trigger) and mirror it exactly for consistency, rather than this DIP inventing a new pattern. Absent that check, my default is an app-layer check inside `softDeleteMember()` (matching how `NOT_FOUND_IN_TENANT` was added there) using `INVALID_STATE_TRANSITION` as the closest canonical fit — but this is provisional, not a decision to lock in blindly.
* The guard checks by reference, not by the target member's own role — per FP-74's own note ("applies specifically to the Leader role — Admins have no equivalent dangling-reference risk"), this is about scope/rationale, not mechanism: the check is simply "does any active `LEADER`-type assignment currently point at this member id," regardless of what role the member being deactivated currently holds.
* Atomicity: the bulk reassign is a batch of N single-member reassignments that must all succeed or all fail together — implemented as one `SECURITY DEFINER` function looping over affected members and calling `set_member_pastoral_leader()` for each, inside one transaction. If any row's target validation fails (e.g., incoming leader turns out cross-tenant), the whole batch rolls back — standard Postgres function-transaction semantics, no extra work needed to get this right.
* Audit trail deliberately reuses existing semantics rather than inventing a "batch" event type: each reassigned member gets its own `SET_PASTORAL_LEADER` audit row (via the reused function), individually attributable, exactly as if it had been done one at a time. No separate summary/batch audit row — flagging this as a deliberate simplicity choice, not an oversight; a "N members were bulk-reassigned in one action" rollup is a reasonable future enhancement if wanted, but isn't asked for by either story's AC.
* No new assignment mechanism, no new trigger: cross-tenant and (pending adj-1) role validation is already enforced by the existing trigger firing on each per-member INSERT inside the loop — nothing to duplicate.
* Migration head: last confirmed live at `20260713000036` (Group B's migration). Re-confirm live, don't trust that number.
Implementation Plan
Phase 0 — Branch & live verification

1. Branch `feature/FP-73-FP-74-bulk-reassign-deactivation-guard` off `dev`.
2. Confirm current migration head live.
3. Confirm whether `DIP-FP-69-FP-72-adj-1` was ever executed — check `validate_assignment_tenant()`'s live body for the `role IN ('LEADER','ADMIN')` clause. Note the finding in the PR description; it determines the incoming-Leader picker's filter.
4. Grep for FP-29's Talk-deletion-block implementation (error code, enforcement layer) and note the finding — this determines FP-74's exact error code and where the check lives.
5. Confirm `set_member_pastoral_leader()`'s live signature is unchanged since Group A.
6. Persist this DIP verbatim to `documentation/dips/DIP-FP-73-FP-74.md` before any other change.
Phase 1 — Schema (single new migration file) 7. `bulk_reassign_leader_members_with_audit(p_outgoing_leader_id UUID, p_incoming_leader_id UUID, p_tenant_id UUID, p_actor_member_id UUID) RETURNS TABLE (reassigned_count INT)` — `SECURITY DEFINER`:

* `RAISE EXCEPTION 'VALIDATION_ERROR: outgoing and incoming leader must differ'` if `p_outgoing_leader_id = p_incoming_leader_id`.
* Select every distinct `member_id` with an active (`deleted_at IS NULL`) `LEADER`-type assignment where `leader_member_id = p_outgoing_leader_id AND tenant_id = p_tenant_id`.
* Loop over that set calling `set_member_pastoral_leader(member_id, p_incoming_leader_id, p_tenant_id, p_actor_member_id)` for each — reusing Group A's function verbatim, per FP-73's own AC. Its internal trigger validates `p_incoming_leader_id` on the first iteration; a failure aborts the whole transaction.
* Return the count of members reassigned (`0` is a valid, non-error result if the outgoing leader currently has nobody assigned).

8. FP-74's guard — exact form (error code, app-layer vs. trigger) contingent on Phase 0.4's live finding. Default absent that finding: extend `softDeleteMember()` to check `SELECT COUNT(*) FROM assignments WHERE leader_member_id = p_member_id AND assignment_type = 'LEADER' AND deleted_at IS NULL AND tenant_id = p_tenant_id` before performing the soft-delete; if `count > 0`, throw with the FP-29-matching code (or `INVALID_STATE_TRANSITION` if no closer precedent exists) and include the count in the thrown error's detail so the app layer can surface "N members still assigned — reassign them first."
9. `supabase db reset` locally to validate before touching application code.
Phase 2 — Application layer 10. `src/features/assignments/service.ts`: - Add `getMembersAssignedToLeader(leaderMemberId, tenantId)` — read, same shape as `getMyAssignedMembers`, filtered by `leader_member_id` param instead of the caller's own id. Used both by the Bulk Reassign screen (to show "N members currently assigned") and by FP-74's blocked-deactivation UI (to show who's affected). - Add `bulkReassignLeaderMembers(outgoingLeaderId, incomingLeaderId, tenantId, actorMemberId)` — thin wrapper over the new RPC, mapping its `VALIDATION_ERROR`/`CROSS_TENANT_ACCESS`/`INVALID_TARGET` exceptions the same way `setPastoralLeader()` already does. 11. `src/features/members/service.ts`: extend `softDeleteMember()` per Phase 1.8's finding; remove the now-obsolete `TODO(FP-74)` comment at the call site once the real guard replaces it. 12. `app/api/members/route.ts`: update the `DELETE` handler's error mapping to surface the new blocking code as 409, with the affected-member count in the response body. 13. New file `app/api/assignments/bulk-reassign-leader/route.ts` — `POST`, Admin-only, body `{ outgoingLeaderMemberId, incomingLeaderMemberId }`, calls `bulkReassignLeaderMembers`. 14. Extend `GET /api/assignments` (or add a query param) to support `?leaderMemberId=` for admin-facing lookups of "who's currently assigned to this leader" — backing both the Bulk Reassign screen and the blocked-deactivation UI's member list.
Phase 3 — Frontend 15. New page `app/admin/(shell)/members/[id]/reassign/page.tsx` (mirroring the Member Edit directory convention) — pre-filled with this member as the outgoing Leader, shows the current count/list of assigned members (via the new read), a dropdown to pick the incoming Leader (filter contingent on Phase 0.3's adj-1 finding), and a confirm action calling the new bulk-reassign endpoint. 16. `MemberEditForm.tsx`'s Deactivate flow: catch the new blocking error code specifically (rather than showing the generic error banner) and render a message with a link to the new Reassign screen for this member, per FP-74's AC ("surfacing the Bulk Reassign action as the resolution path"). 17. Cancel/Back navigation on the new screen, following the established convention.
Files to Create/Modify

* `supabase/migrations/[NEXT_SEQUENTIAL_TIMESTAMP]_bulk_reassign_leader_and_deactivation_guard.sql` (new)
* `src/features/assignments/service.ts` (modify)
* `src/features/members/service.ts` (modify)
* `app/api/members/route.ts` (modify)
* `app/api/assignments/route.ts` (modify — `?leaderMemberId=` support) or a new dedicated route, whichever fits the live convention better; confirm before choosing.
* `app/api/assignments/bulk-reassign-leader/route.ts` (new)
* `app/admin/(shell)/members/[id]/reassign/page.tsx` + supporting form component (new)
* `app/admin/(shell)/members/[id]/edit/MemberEditForm.tsx` (modify — blocked-deactivation UI)
Migration Files

```sql
-- supabase/migrations/[NEXT_SEQUENTIAL_TIMESTAMP]_bulk_reassign_leader_and_deactivation_guard.sql
-- FP-73/FP-74: bulk Leader reassignment (reuses set_member_pastoral_leader() per-member,
-- per FP-73's own AC) + deactivation guard blocking a still-assigned Leader from being
-- deactivated. CC: confirm set_member_pastoral_leader()'s live signature is unchanged
-- before relying on it here, and confirm FP-29's exact error code/enforcement layer before
-- finalizing the guard below — the code and layer here are provisional pending that check.

CREATE OR REPLACE FUNCTION public.bulk_reassign_leader_members_with_audit(
  p_outgoing_leader_id UUID,
  p_incoming_leader_id UUID,
  p_tenant_id UUID,
  p_actor_member_id UUID
)
RETURNS TABLE (reassigned_count INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE
  v_member_id UUID;
  v_count INT := 0;
BEGIN
  IF p_outgoing_leader_id = p_incoming_leader_id THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: outgoing and incoming leader must be different members';
  END IF;

  FOR v_member_id IN
    SELECT DISTINCT a.member_id
    FROM assignments a
    WHERE a.leader_member_id = p_outgoing_leader_id
      AND a.tenant_id = p_tenant_id
      AND a.assignment_type = 'LEADER'
      AND a.deleted_at IS NULL
  LOOP
    -- Reuses the exact same retire-old/insert-new logic as a single reassignment
    -- (Group A's set_member_pastoral_leader()) — per FP-73's own AC, no new mechanism.
    -- Its internal trigger validates p_incoming_leader_id on first use; any failure
    -- aborts this whole function's transaction.
    PERFORM set_member_pastoral_leader(v_member_id, p_incoming_leader_id, p_tenant_id, p_actor_member_id);
    v_count := v_count + 1;
  END LOOP;

  RETURN QUERY SELECT v_count;
END;
$$;

-- FP-74 guard: provisional pending live confirmation of FP-29's exact code/layer.
-- CC: if FP-29 used a DB-level check (trigger) rather than an app-layer one, mirror that
-- instead of adding this at the service-layer call site.
--
-- Reference query for the app-layer check in softDeleteMember():
--   SELECT COUNT(*) FROM assignments
--   WHERE leader_member_id = <member_id> AND tenant_id = <tenant_id>
--     AND assignment_type = 'LEADER' AND deleted_at IS NULL;
-- If > 0, reject before performing the soft-delete.

```

Branch Name
`feature/FP-73-FP-74-bulk-reassign-deactivation-guard`
Commit Message
`FP-73-FP-74: implement bulk leader reassignment and block deactivation while members still assigned`
Pull Request Description

* FP-73: New Admin-only bulk reassignment — pick outgoing/incoming Leader, every member currently assigned to the outgoing Leader moves to the incoming one atomically, reusing `set_member_pastoral_leader()` per-member exactly as the story's AC specifies.
* FP-74: Deactivating a member now blocked while they're still someone's active Pastoral Leader; blocked UI surfaces a direct link to the new Bulk Reassign screen for that member.
* Note whether `DIP-FP-69-FP-72-adj-1` had already landed (determines the incoming-Leader picker's role filter) and what FP-29's precedent turned out to be (determines the guard's exact error code/layer) — both were open at DIP-drafting time, resolved live during implementation.
Jira Linkage

* PDEEpicID: FP-8 (EPIC-2 — Member & Group Management)
* PDEStoryID: FP-73, FP-74
Stop Point
Save this DIP verbatim to `documentation/dips/DIP-FP-73-FP-74.md` and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against `dev` and stop. Do not merge — the user will review, merge, and test against deployed `dev` afterward.
Include full diffs for every file in the completion report — no elisions — plus `git diff dev [branch] -- [path]` showing zero output for any file this DIP required to stay untouched.
