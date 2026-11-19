# DIP-FP-60-FP-61-FP-64-FP-65-FP-67

### Story Summary
This is the Core Admin Surface for Event Management — List, Create, Edit, Cancel, and Roster — the primary set of screens an Admin actually uses day-to-day to run events. All five share the same underlying table (`events`) and largely the same UI surface (an Events List screen linking into an Event Detail screen), with real interdependencies: FP-64's Edit screen reuses FP-61's Create form field-for-field; FP-65's Cancel action and FP-67's Roster view both live on the Event Detail screen that FP-60's List links into. The Foundation DIP (`FP-58-59-62`) has already shipped and merged, which resolves two things FP-61 was previously blocked on or working around: the Event Type dropdown now has real CRUD-backed data (FP-58) instead of one hardcoded "General" row, and `POST /api/events` now accepts `talkId` directly (FP-59) — so FP-61's documented create-then-PATCH workaround for Talk assignment is no longer needed and should not be built. The multi-group/multi-member target picker (FP-62) is also now meaningful to build a UI on top of.

Scope note, flagged explicitly rather than silently added: none of these five stories individually asks for an "Event Detail" screen, but FP-65's cancel action and FP-67's roster view both describe living on one — so standing up a minimal Event Detail screen is necessary supporting infrastructure for this DIP, not scope creep. It's built here as the natural home for Cancel + Roster + an Edit link, and as what FP-60's List screen navigates into.

### Repo Target
Web (Next.js) — all five stories are Admin-facing screens and their backing API routes in `owgc-tech/flockpulse-web`.

### Grounding Check
- No Section 4 invariant conflicts. This is event lifecycle and RSVP-visibility UI — no self-report, confirmation, or formation-completion logic is touched. FP-67's roster is explicitly scoped to RSVP only (pre-event intent), not self-report or official attendance — do not expand it, per the story's own Design Decision.
- Schema/function verification required before writing anything — do not assume from this DIP's description:
  - Confirm `get_event_effective_status()` (FP-47) still exists under this exact name and signature before reusing it for FP-60's list.
  - Read the full current body of `updateEvent()` in `src/features/events/service.ts` — FP-64's Jira AC claims `LOCKED`/`CANCELLED` immutability and `talk_id` immutability-once-dispatched are "already enforced, unchanged by this story." Confirm this is actually true in the live code before assuming FP-64 needs no new backend validation logic.
  - Confirm `block_actions_on_cancelled_or_locked()` (referenced in FP-65's Jira as already existing from FP-13/remediation) exists under this name — this DIP does not need to touch it, only confirm it's still what blocks other actions on a cancelled event.
  - Confirm `trigger_suppress_notifications_on_cancel` is still wired on `events` (AFTER UPDATE) — the new cancel function in this DIP relies on this firing automatically from a plain status UPDATE; do not duplicate its logic.
  - Confirm the current admin shell routing convention (`app/admin/(shell)/...`) and the location of `AdminSidebar.tsx` before creating any new page — new Admin routes must live under the shell and get added to the sidebar, per established convention since FP-104.
  - Confirm the current `events` table's exact column list live (already confirmed empty of `location_address`/`location_url` as of the Foundation DIP's grounding — but re-verify, don't trust a stale snapshot) and confirm whether any `events` rows exist in the actual dev/remote environment before writing the `NOT NULL` migration for `location_address` (not just local — local was empty at Foundation DIP time, but real events may exist by now if any manual testing happened since).
- Naming: no new invariant-domain tables/fields. `location_address`/`location_url` are new `events` columns — plain schema additions, no conflict with Section 4's reserved names.
- Cross-tenant safety: FP-67's roster join (`event_attendees` × `rsvps`) must be tenant-scoped on both sides — standard pattern already used everywhere else in this codebase, just confirm it's applied here too.
- Canonical error codes: FP-65's cancel-blocked-by-state case should reuse `INVALID_STATE_TRANSITION` (already used in `talk.service.ts` for analogous "can't do this from this state" cases) rather than inventing a new code. FP-61/64's required-field validation should reuse `MISSING_FIELD`, matching the existing `POST /api/events` pattern.
- Migration idempotency applies to the new `location_address`/`location_url` migration — standard checklist item, plus the safe nullable-then-backfill-then-NOT-NULL sequence (mirroring the pattern already used for `members.gender`/`marital_status`/`birthdate` in the registration-completion migration) since `location_address` is required but must not break any pre-existing `events` rows.

### Implementation Plan
Phase 0 — Grounding
1. Branch off `dev`.
2. Read every file/function listed in the Grounding Check above. Confirm live, don't assume.
3. Confirm the admin shell route convention and `AdminSidebar.tsx`'s current contents before adding new routes.

Phase 1 — Migration: location fields (prerequisite for FP-61/64)
4. Add `events.location_address` and `events.location_url`:
   - `ADD COLUMN IF NOT EXISTS` both, nullable first.
   - Backfill any existing rows (confirm live whether any exist) — a reasonable default is copying `location_name` into `location_address` if no better data exists, but confirm with the user if real event data exists and this default seems wrong before assuming it's fine.
   - `ALTER COLUMN location_address SET NOT NULL` after backfill. `location_url` stays nullable — it's an optional override.

Phase 2 — FP-61: Create Event screen
5. New Create Event screen under the admin shell. Fields: name, event type (dropdown, now real data via FP-58), location name, location address (required), location URL (optional), target (multi-group + multi-member picker, using FP-62's shape), start/end datetime.
6. Formation cascade: when the selected event type's `code = 'FORMATION'`, show Course → Module → Talk cascading selects using the existing `/api/courses`, `/api/modules?course_id=`, `/api/talks?module_id=` endpoints. No new backend needed for the cascade itself.
7. Submit via `POST /api/events`, passing `talkId` directly in the same call — no create-then-PATCH workaround, since FP-59 already wired this through.
8. One-tap navigation link: construct client-side from `location_address` via a universal maps URL scheme when `location_url` is not set; use `location_url` directly when it is set. (A Google Maps universal query link is a reasonable default — confirm this renders sensibly on both platforms before finalizing.)

Phase 3 — FP-60: Events List screen
9. Modify `listEvents()` (or the `GET /api/events` route) to include each event's effective status via `get_event_effective_status()` — reuse, don't reimplement the DRAFT/SCHEDULED/ACTIVE/COMPLETED/LOCKED derivation logic.
10. List UI: name, type, date/time, effective status, target summary (a readable rendering of `group_ids`/`member_ids` — e.g. group names plus an explicit-member count; exact format is a UI judgment call, not specified further here). Clicking a row navigates to the Event Detail screen (built next).

Phase 4 — Event Detail screen (supporting infrastructure)
11. New Event Detail screen under the admin shell — shows event fields, effective status, an Edit link (→ Phase 5), a Cancel action (→ Phase 6), and the RSVP roster (→ Phase 7).

Phase 5 — FP-64: Edit Event screen
12. Edit screen reuses the Create screen's fields, pre-populated from the event, submitting via the existing `PATCH /api/events/[id]` route.
13. Extend the `PATCH` route/`updateEvent()` to accept `locationAddress`/`locationUrl` in the patch (the route already accepts `target`/`talkId` per the Foundation DIP). Confirm from Phase 0's grounding whether `LOCKED`/`CANCELLED` blocking and `talk_id` immutability are truly already enforced — if they are, no new validation logic is needed here beyond the two new location fields.

Phase 6 — FP-65: Cancel action
14. New `SECURITY DEFINER` function `cancel_event_with_audit()`, matching the atomic pattern of `insert_event_with_audit()`/`update_event_with_audit()`: fetch current state, raise if already `CANCELLED` or `LOCKED`, set `status = 'CANCELLED'`, write the audit entry — all in one function call. The existing `trigger_suppress_notifications_on_cancel` fires automatically off the plain `UPDATE` inside this function; do not duplicate that logic.
15. New route `POST /api/events/[id]/cancel`, Admin only, calling this function with `actorMemberId` derived server-side from `ctx.memberId` (never client-supplied — same pattern established in the Foundation DIP).
16. Irreversible — no un-cancel action. No confirmation/notification sent to invited members on cancel — this is an accepted, deliberate gap per the story (mobile-side display of cancelled events is separate, out-of-scope mobile work).
17. Cancel button on the Event Detail screen, disabled/hidden appropriately once already `CANCELLED` or `LOCKED`.

Phase 7 — FP-67: Event Roster
18. New route `GET /api/events/[id]/roster`, Admin only — joins `event_attendees` (the full invited roster) against `rsvps` (their response if any) for the given event, tenant-scoped on both sides.
19. Members with no matching `rsvps` row show as "not responded." `rsvp_status = 'YES'` → accepted; `'NO'` → declined with `rsvp_reason` visible.
20. Roster list rendered on the Event Detail screen, grouped or filterable by response status. Strictly RSVP-scoped — do not pull in self-report or official attendance data; that's explicitly a future extension, not this story.

Phase 8 — Regression
21. Confirm the full `events`-related regression suite (the Foundation DIP's dedicated test script, plus `test-fp45-validate-event-type.ts`) still passes against these changes.
22. Add new regression coverage for: effective-status list output, location field validation, the cancel function's state-blocking behavior, and the roster join's not-responded/accepted/declined classification.

### Files to Create/Modify
- `supabase/migrations/[next]_event_location_fields.sql` (new)
- `supabase/migrations/[next]_cancel_event_with_audit.sql` (new)
- `app/api/events/route.ts` (modify — include effective status in `GET`)
- `app/api/events/[id]/route.ts` (modify — accept `locationAddress`/`locationUrl` in `PATCH`)
- `app/api/events/[id]/cancel/route.ts` (new)
- `app/api/events/[id]/roster/route.ts` (new)
- `src/features/events/service.ts` (modify — `listEvents()` effective-status join, `updateEvent()` location fields, new `cancelEvent()`/`getEventRoster()` service functions)
- Admin shell pages: Events List, Create Event, Edit Event, Event Detail (exact paths to confirm against the live `app/admin/(shell)/` convention in Phase 0)
- `AdminSidebar.tsx` (modify — add Events nav entry)

### Migration Files (if applicable)
```sql
-- DIP-FP-60-61-64-65-67, Phase 1: location fields

ALTER TABLE events ADD COLUMN IF NOT EXISTS location_address TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS location_url TEXT;

-- Backfill: confirm live whether any events rows exist and what's appropriate.
-- Illustrative only — copies location_name as a placeholder if no better data exists.
UPDATE events SET location_address = location_name WHERE location_address IS NULL;

ALTER TABLE events ALTER COLUMN location_address SET NOT NULL;
```

```sql
-- DIP-FP-60-61-64-65-67, Phase 6: cancel_event_with_audit()

CREATE OR REPLACE FUNCTION public.cancel_event_with_audit(
    p_event_id UUID,
    p_tenant_id UUID,
    p_actor_member_id UUID
)
RETURNS TABLE (id UUID, status TEXT, updated_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_before JSONB;
  v_row events%ROWTYPE;
BEGIN
  SELECT to_jsonb(e) INTO v_before FROM events e WHERE e.id = p_event_id AND e.tenant_id = p_tenant_id;
  IF v_before IS NULL THEN
    RAISE EXCEPTION 'event % not found for tenant %', p_event_id, p_tenant_id;
  END IF;
  IF v_before->>'status' IN ('CANCELLED', 'LOCKED') THEN
    RAISE EXCEPTION 'event % cannot be cancelled from status %', p_event_id, v_before->>'status';
  END IF;

  UPDATE events SET status = 'CANCELLED', updated_at = now()
  WHERE id = p_event_id AND tenant_id = p_tenant_id
  RETURNING * INTO v_row;

  PERFORM write_audit_log(p_tenant_id, 'event', v_row.id, 'cancel', p_actor_member_id, v_before, to_jsonb(v_row));

  RETURN QUERY SELECT v_row.id, v_row.status, v_row.updated_at;
END;
$$;
```

(CC: confirm the exact live column set on `events` and the exact `write_audit_log` signature before finalizing — both were correct as of the Foundation DIP's grounding, but re-verify.)

### Branch Name
`feature/FP-60-61-64-65-67-event-admin-core-surface`

### Commit Message
`FP-60-FP-61-FP-64-FP-65-FP-67: Event list, create, edit, cancel, and roster admin screens`

### Pull Request Description
- FP-60: Events List shows derived effective status (reusing `get_event_effective_status()`) and a target summary.
- FP-61: Create Event screen — location fields, real Event Type dropdown, multi-group/member target picker, Formation cascade, direct `talkId` submission (no workaround).
- FP-64: Edit Event screen, reusing Create's fields; confirms and preserves existing `LOCKED`/`CANCELLED`/`talk_id`-immutability enforcement.
- FP-65: Cancel action — irreversible, blocked once already `CANCELLED`/`LOCKED`, relies on the existing notification-suppression trigger rather than duplicating it.
- FP-67: RSVP roster on the Event Detail screen — accepted/declined/not-responded, strictly RSVP-scoped.
- Note explicitly: an Event Detail screen was built as necessary supporting infrastructure for FP-65/67, not separately ticketed — flagged here per the DIP's Story Summary.

### Jira Linkage
- PDEEpicID: FP-11 (EPIC-3 — Event Lifecycle Management)
- PDEStoryID: FP-60, FP-61, FP-64, FP-65, FP-67

### Stop Point
Save this DIP verbatim to `documentation/dips/DIP-FP-60-FP-61-FP-64-FP-65-FP-67.md` and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against `dev` and stop. Do not merge — wait for Atlas to review the diffs and confirm the PR looks good; the user will then merge and test against the deployed `dev` environment afterward.
Include full diffs for every file in your completion report — not a summary.
