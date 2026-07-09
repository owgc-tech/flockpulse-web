# DIP-FP-107

### Story Summary
Adds two new, always-optional fields to every event, regardless of event type: Prayer Leader (a single member) and Food Assignment (multiple groups and/or individual members, reusing the exact same picker already built for event targeting). Per the user's explicit direction, these are not gated by event type — they show up on every Create/Edit Event form and on the Event Detail screen, and an event can be published with either or both left blank. Both are purely informational assignment metadata — nothing about roster materialization, RSVP, attendance, or Formation completion changes; `handle_event_scheduling()` is untouched.

### Repo Target
Web (Next.js) — extends the existing Create/Edit Event screens and Event Detail screen in `owgc-tech/flockpulse-web`.

### Repo Target
Web (Next.js).

### Grounding Check
- No Section 4 invariant conflicts. Pure event metadata addition — no RSVP/self-report/attendance/formation-completion logic touched.
- Schema verification required — the `events` table has changed three times in the last four merged DIPs (location fields, `event_series`/`recurrence_series_id`). Confirm the full live column list before adding two more, don't assume any prior snapshot is current.
- Confirm `insert_event_with_audit()` and `update_event_with_audit()`'s current live signatures before extending them — both changed once already (location fields) and `RETURNS TABLE` column-set changes require `DROP FUNCTION IF EXISTS` before `CREATE OR REPLACE`, per the lesson already learned and documented in the Core Admin Surface DIP (Postgres rejects `CREATE OR REPLACE` when the output column set changes).
- Confirm `validate_event_talk_id()`'s current body to mirror its exact shape for the new `prayer_leader_member_id` cross-tenant trigger — same pattern, different column.
- Confirm `target`'s current handling has no write-time cross-tenant trigger (tenant-scoped filtering happens downstream, at roster-materialization time in `handle_event_scheduling()`) before applying the same precedent to `food_assignment` — this DIP follows that existing established design choice deliberately, it does not introduce a new gap.
- Confirm `EventForm.tsx`'s current Target multi-select JSX before extracting it into a shared component for reuse by Food Assignment — same reasoning as `RepeatsFields` being factored out in DIP-FP-106, to prevent the two pickers from silently diverging in behavior.
- Confirm `EventDetail.tsx`'s current props — it does not currently receive a `members` list (only `eventTypes` and `groups`), but displaying the Prayer Leader's name and Food Assignment's member names requires one. Confirm this gap live before assuming it needs adding.
- Explicit scope-narrowing decision, flagged rather than silently resolved: FP-63's recurring-series creation and FP-106's conversion both template several fields (name, location, target, event type, talk_id) onto every generated occurrence. This DIP does not extend `create_event_series_with_audit()` or `convert_event_to_series_with_audit()` to also template Prayer Leader/Food Assignment — occurrences generated via a series will have both fields `NULL`, settable individually per-occurrence afterward via Edit, same as any single event. This is a deliberate scope boundary for this DIP, not an oversight — extending series templating to cover these two fields is a reasonable follow-up if wanted, but is out of scope here since neither FP-107's AC nor the two series stories asked for it.
- Canonical error codes: no new validation beyond basic type/existence checks — reuse `INVALID_TARGET`-style handling (or the existing pattern for `talk_id`) for a cross-tenant `prayer_leader_member_id`, nothing new to invent.
- Migration idempotency applies as usual.

### Implementation Plan
Phase 0 — Grounding
1. Branch off `dev`. Confirm every item in the Grounding Check live before writing code.

Phase 1 — Migration: schema + cross-tenant trigger
2. `ALTER TABLE events ADD COLUMN IF NOT EXISTS prayer_leader_member_id UUID REFERENCES members(id)` (nullable).
3. `ALTER TABLE events ADD COLUMN IF NOT EXISTS food_assignment JSONB` (nullable — absent/`NULL` treated as "unassigned", same as `target`'s missing-key handling already confirmed safe via `jsonb_array_elements_text` on a missing key).
4. New trigger `trigger_validate_event_prayer_leader_tenant_scope` (`BEFORE INSERT OR UPDATE ON events`), mirroring `validate_event_talk_id()` exactly — reject if `prayer_leader_member_id` is set and doesn't belong to the same tenant.
5. No new trigger for `food_assignment` — same precedent as `target`.

Phase 2 — Extend the audit-write RPCs
6. `DROP FUNCTION IF EXISTS` + recreate `insert_event_with_audit()` and `update_event_with_audit()` to accept and store `p_prayer_leader_member_id` and `p_food_assignment`, following the exact pattern used when location fields were added.

Phase 3 — Service layer
7. Extend `CreateEventInput`/`UpdateEventInput` in `service.ts`, the RPC call parameters in `createEvent()`/`updateEvent()`, and the `SELECT` column lists in `getEventById()`/`listEvents()`.

Phase 4 — UI
8. Extract the existing Target multi-select JSX in `EventForm.tsx` into a shared `GroupMemberMultiSelect` component (mirroring how `RepeatsFields` was extracted in DIP-FP-106) — reused for both Target and the new Food Assignment field, so the two pickers can't diverge in behavior.
9. Add a Prayer Leader single-select `<select>` of members (the `members` prop already passed to `EventForm.tsx`) — optional, no `required` attribute.
10. Add the Food Assignment section using the new shared multi-select component — optional.
11. `EventDetail.tsx`: add a `members` prop (fetched by the Detail page's server component, same pattern as `groups`/`eventTypes`) and display Prayer Leader's name and Food Assignment's group/member names, following the existing target-summary rendering pattern.

Phase 5 — Regression
12. Confirm all five prior event-related regression suites still pass unmodified.
13. New coverage: both fields settable and round-tripping correctly through create/update; both fields correctly absent/null by default; cross-tenant rejection of `prayer_leader_member_id`; a cross-tenant id inside `food_assignment` is silently excluded at read/display time (not rejected at write time), consistent with `target`'s existing behavior — don't test for a rejection that this DIP deliberately doesn't implement; an event published with both fields unset succeeds without error.

### Files to Create/Modify
- `supabase/migrations/[next]_event_prayer_leader_food_assignment.sql` (new) — columns, cross-tenant trigger, updated `insert_event_with_audit()`/`update_event_with_audit()`
- `src/features/events/service.ts` (modify — types, `createEvent()`/`updateEvent()`, `getEventById()`/`listEvents()`)
- `src/features/events/event.types.ts` (modify — new fields on `EventListRow`/`EventDetailRow`/`CreateEventInput`-equivalent types)
- `app/admin/(shell)/events/GroupMemberMultiSelect.tsx` (new — extracted shared component)
- `app/admin/(shell)/events/EventForm.tsx` (modify — Prayer Leader select, Food Assignment section, Target refactored to use the new shared component)
- `app/admin/(shell)/events/[id]/EventDetail.tsx` (modify — display both fields; add `members` prop)
- `app/admin/(shell)/events/[id]/page.tsx` (modify — fetch and pass `members` to `EventDetail`)

### Migration Files (if applicable)
```sql
-- DIP-FP-107: Prayer Leader and Food Assignment fields on events

ALTER TABLE events ADD COLUMN IF NOT EXISTS prayer_leader_member_id UUID REFERENCES members(id);
ALTER TABLE events ADD COLUMN IF NOT EXISTS food_assignment JSONB;

-- Mirrors validate_event_talk_id() exactly — same pattern, different column.
CREATE OR REPLACE FUNCTION public.validate_event_prayer_leader_tenant_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.prayer_leader_member_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM members
      WHERE id = NEW.prayer_leader_member_id AND tenant_id = NEW.tenant_id AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'events.prayer_leader_member_id % is invalid, soft-deleted, or belongs to a different tenant', NEW.prayer_leader_member_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_validate_event_prayer_leader_tenant_scope ON events;
CREATE TRIGGER trigger_validate_event_prayer_leader_tenant_scope
BEFORE INSERT OR UPDATE ON events
FOR EACH ROW EXECUTE FUNCTION validate_event_prayer_leader_tenant_scope();

-- CC: confirm the live current signatures of insert_event_with_audit()/update_event_with_audit()
-- before finalizing — DROP FUNCTION IF EXISTS with the exact current parameter list is required
-- before CREATE OR REPLACE, since the RETURNS TABLE column set is changing again.
```

(CC: the full `DROP`/`CREATE OR REPLACE` for both audit-write functions is intentionally not drafted here — confirm their exact current parameter lists live first, per the Grounding Check, rather than working from a possibly-stale snapshot.)

### Branch Name
`feature/FP-107-prayer-leader-food-assignment`

### Commit Message
`FP-107: Add Prayer Leader and Food Assignment fields to events`

### Pull Request Description
- Maps to FP-107 AC: Prayer Leader (single member, FK with cross-tenant trigger) and Food Assignment (groups/members, same shape as `target`, same no-hard-trigger precedent) added to every event, both optional, no event-type gating.
- Explicitly note in the PR: recurring-series creation/conversion (FP-63/FP-106) does not template these two fields onto generated occurrences — flagged as a deliberate scope boundary, not an oversight.

### Jira Linkage
- PDEEpicID: FP-11 (EPIC-3 — Event Lifecycle Management)
- PDEStoryID: FP-107

### Stop Point
Save this DIP verbatim to `documentation/dips/DIP-FP-107.md` and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against `dev` and stop. Do not merge — the user will merge once Atlas has reviewed the diffs and confirmed the PR looks good; testing happens afterward against the deployed `dev` environment.
Include full diffs for every file in your completion report — not a summary.
