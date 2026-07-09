# DIP-FP-58-FP-59-FP-62

### Story Summary
This is the Foundation layer for the Event Management work package — three backend-only stories that the next DIP (Create/Edit/List/Cancel/Roster, `FP-60-61-64-65-67`) cannot be built correctly without. FP-58 adds real CRUD to `event_types` (it's existed as a table since FP-45 but only ever got one seeded "General" row — no API). FP-62 rewrites `handle_event_scheduling()` so events can target multiple groups and multiple individual members instead of a single hardcoded `group_id` — this is a genuine prerequisite for FP-61's target picker to mean anything. FP-59 wires `talkId` and `actorMemberId` through `POST /api/events`, which the service layer already supports but the route never passed through — folding this in means FP-61 can skip its documented create-then-PATCH workaround for Talk assignment entirely. No UI is built in this DIP — the Create Event screen itself is FP-61, next.

### Repo Target
Web (Next.js) — all three stories are backend/schema work in `owgc-tech/flockpulse-web`.

### Grounding Check
- No Section 4 invariant conflicts. None of RSVP, self-report, attendance, or formation-completion logic is touched. FP-62 touches event roster materialization (`event_attendees`), which is upstream of attendance but not attendance itself.
- Schema verification is mandatory and non-trivial here — the last known snapshot of `handle_event_scheduling()` predates several rounds of change (FP-45's `event_types`, FP-13's cron-driven state transitions, the RBAC remediation pass, and possibly more since). Before writing anything, read live:
  - The full current `events` table definition (confirm `talk_id`, `event_type_id`, `version`, and current `target` shape/usage)
  - The current body of `handle_event_scheduling()` and its trigger definition
  - `src/features/events/service.ts` — current `createEvent()`, `publishEvent()`/`updateEvent()` signatures and whatever audit-write mechanism they call
  - The current `POST /api/events` route file — confirm exactly which fields it does and doesn't pass through today
  - `insert_event_with_audit()` — confirm it exists, its exact parameter name for actor (Jira says `actorMemberId` is unwired — confirm the function already accepts an actor parameter that's simply never being passed)
  - The Course/Module/Talk CRUD route pattern (`app/api/courses/`, `/api/modules/`, `/api/talks/`) to mirror exactly for `event-types` — confirm the actual current shape (service-role client + app-layer Admin check, per this codebase's established enforcement model — RLS is backstop only) rather than assuming from an older Groups/Assignments pattern
  - `validateTalkIdForEvent` and the `INVALID_FORMATION_LINK` error code — confirm these exist under these exact names before reusing them
- Cross-tenant safety (Section 5, Rule 4) applies directly to FP-62's rewrite. The new trigger resolves membership from both `group_ids[]` and `member_ids[]` supplied in `target` — client-influenced input flowing into a roster-materialization query. Every group_id and member_id resolved must be validated as belonging to the same tenant as the event before being inserted into `event_attendees`. Don't assume the service layer already guarantees this — verify, and add the check in the trigger itself if it's not already enforced upstream.
- Atomicity: roster materialization across multiple groups + multiple members stays inside the single `handle_event_scheduling()` trigger execution — already atomic as one function call, no new `SECURITY DEFINER` split required.
- Canonical error codes: FP-58's CRUD should reuse whatever codes the Course/Module/Talk pattern already uses (confirm exact codes live — don't invent `EVENT_TYPE_NOT_FOUND` if `NOT_FOUND` already covers it elsewhere). FP-59 reuses `INVALID_FORMATION_LINK` — confirmed to already exist, not introduced here.
- Migration idempotency applies to any new migration in this DIP — standard checklist item.

### Implementation Plan
Phase 0 — Grounding
1. Branch off `dev`.
2. Read every file listed in the Grounding Check above. Do not proceed on assumptions from this DIP's description of prior state — confirm live.
3. Check `documentation/dips/` for any prior DIP file touching `event_types`, `handle_event_scheduling`, or `POST /api/events` beyond what's already known (FP-45, FP-13, RBAC remediation) — confirm no other undocumented prior work exists.

Phase 1 — FP-58: Event Type CRUD
4. Implement `GET /api/event-types`, `POST /api/event-types`, `PATCH /api/event-types/[id]` mirroring the confirmed Course/Module/Talk pattern exactly: Admin-only write, tenant-wide read, soft-delete via `PATCH` setting `deleted_at`.
5. Confirm `code = 'FORMATION'` is the reserved value already anticipated (per FP-45/58's design) for triggering Formation-specific UI cascade behavior later in FP-61 — this DIP just needs the CRUD to support setting/reading `code` normally, not any special-casing of the value itself.
6. No RLS-reliant enforcement — service-role client + app-layer Admin check, matching every other admin-managed table in this codebase.

Phase 2 — FP-62: Multi-group/multi-member targeting (do this before Phase 3 — it changes `target`'s shape)
7. `events.target` shape changes conceptually from `{group_id}` to `{group_ids: string[], member_ids: string[]}`. Confirm whether any existing rows/tests assume the old single-`group_id` shape and whether a data migration/backfill is needed for existing DRAFT events, or whether it's safe to assume none exist yet in any real environment.
8. Rewrite `handle_event_scheduling()`:
   - Union: every member belonging to any group in `target->'group_ids'` (via `assignments` where `assignment_type = 'GROUP'`, `deleted_at IS NULL`, `group_id = ANY(...)`, tenant-scoped) with every member_id explicitly listed in `target->'member_ids'`.
   - Validate every resolved group_id and member_id belongs to the same tenant as the event (cross-tenant safety, per Grounding Check).
   - Deduplicate via the existing unique constraint on `event_attendees(event_id, member_id)` with `ON CONFLICT DO NOTHING` — same pattern already in place, not a new mechanism.
   - "Everyone" is not a special case — it's just a group containing every member. No new code path for it.
9. Full regression: identify every existing test script that exercises event scheduling or roster materialization (at minimum whatever covers FP-13 and the RBAC remediation pass — confirm the actual current list live) and confirm all still pass against the rewritten trigger.

Phase 3 — FP-59: Wire `talkId` and `actorMemberId`
10. `POST /api/events` accepts optional `talkId` in the request body, passes it to `createEvent()`. No new validation logic — `validateTalkIdForEvent`/`INVALID_FORMATION_LINK` (confirmed to exist in Phase 0) already handle correctness.
11. Same route: wire `actorMemberId` through to whatever audit-write mechanism `createEvent()` uses (confirmed live in Phase 0) — currently every event-create audit entry shows `actor_id = null` because the route never passes it.

### Files to Create/Modify
- `app/api/event-types/route.ts` (new)
- `app/api/event-types/[id]/route.ts` (new)
- `src/features/event-types/` — service/repository files, mirroring the confirmed Course/Module/Talk structure exactly
- `supabase/migrations/[next]_multi_target_event_scheduling.sql` (new) — `handle_event_scheduling()` rewrite
- `supabase/migrations/[next]_event_types_crud.sql` (new, only if live verification shows RLS/grants need adjustment for the new CRUD — confirm before assuming this is needed)
- `app/api/events/route.ts` (modify — wire `talkId`/`actorMemberId`)
- `src/features/events/service.ts` (modify — `createEvent()` to accept and pass through `actorMemberId` if not already)

### Migration Files (if applicable)
Raw SQL, written to disk only, never executed live. Representative shape for the FP-62 rewrite — CC must confirm the actual current function body before writing the real `CREATE OR REPLACE`, since this is based on the last known snapshot and may be stale:
```sql
-- DIP-FP-58-59-62: multi-group/multi-member event targeting

CREATE OR REPLACE FUNCTION handle_event_scheduling()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'SCHEDULED' AND OLD.status = 'DRAFT' THEN
    INSERT INTO event_attendees (tenant_id, event_id, member_id)
    SELECT NEW.tenant_id, NEW.id, a.member_id
    FROM assignments a
    WHERE a.group_id = ANY(
            ARRAY(SELECT jsonb_array_elements_text(NEW.target->'group_ids'))::UUID[]
          )
      AND a.assignment_type = 'GROUP'
      AND a.deleted_at IS NULL
      AND a.tenant_id = NEW.tenant_id
    UNION
    SELECT NEW.tenant_id, NEW.id, m.id
    FROM members m
    WHERE m.id = ANY(
            ARRAY(SELECT jsonb_array_elements_text(NEW.target->'member_ids'))::UUID[]
          )
      AND m.tenant_id = NEW.tenant_id
      AND m.deleted_at IS NULL
    ON CONFLICT DO NOTHING;

    -- [existing notification-scheduling block unchanged — confirm live before touching]
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog;
```

(CC: this is illustrative only — replace with the verified current function body plus this change, don't discard whatever else the live version does that isn't shown here, e.g. the notification-scheduling section or any changes from FP-13/remediation not reflected in this snapshot.)

### Branch Name
`feature/FP-58-59-62-event-management-foundation`

### Commit Message
`FP-58-FP-59-FP-62: Event type CRUD, create-time talk/actor wiring, multi-group/member event targeting`

### Pull Request Description
- FP-58: `GET/POST/PATCH /api/event-types` implemented, mirroring Course/Module/Talk CRUD pattern.
- FP-59: `POST /api/events` now accepts `talkId` and `actorMemberId`; audit entries for event creation now show a real actor.
- FP-62: `handle_event_scheduling()` rewritten for multi-group/multi-member targeting; full regression suite for event scheduling/roster materialization re-run and passing.
- Explicitly note in the PR: this is backend-only — no UI changes, since the Create Event screen is FP-61 in the next DIP.

### Jira Linkage
- PDEEpicID: FP-11 (EPIC-3 — Event Lifecycle Management)
- PDEStoryID: FP-58, FP-59, FP-62

### Stop Point
Save this DIP verbatim to `documentation/dips/DIP-FP-58-FP-59-FP-62.md` and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against `dev` and stop. Do not merge — the user will merge once Atlas has reviewed the diffs and confirmed the PR looks good; testing happens afterward against the deployed Vercel preview environment.
Include full diffs for every file in your completion report — not a summary.
