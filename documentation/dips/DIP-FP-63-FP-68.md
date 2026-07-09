# DIP-FP-63-FP-68

### Story Summary
This is the Recurring Series work — the last piece of the Event Management epic. FP-63 extends the Create Event screen (FP-61) with a "repeats" option: the admin picks a frequency (Weekly/Fortnightly/Monthly) and either "repeat N times" or "ends on [date]," and the system generates a fixed, capped batch of independent `events` rows up front, linked by a shared `event_series` record for reference only — each occurrence is edited or cancelled individually afterward, exactly like any other event. FP-68 adds bulk-cancel for a series: cancel every not-yet-occurred occurrence in one action, reusing FP-65's single-event cancel logic per row rather than a new bulk-write mechanism. Bulk edit is deliberately not built — per the story's own Design Decision, "cancel the remainder and create a new corrected series" is the intended workflow for changing something about future occurrences, and this DIP does not second-guess that decision.

### Repo Target
Web (Next.js) — extends the existing Create Event screen and Event Detail screen in `owgc-tech/flockpulse-web`.

### Grounding Check
- No Section 4 invariant conflicts. Pure event-lifecycle/scheduling automation — no RSVP, self-report, attendance, or formation-completion logic touched directly.
- A real tension between this story's AC and a Section 5 standing rule — flagged, with a proposed resolution, not silently resolved: FP-63's AC says each generated occurrence must go "through the same create path (and same validation) as any single event." Read literally, that implies calling the TypeScript `createEvent()` function N times from the route/service layer — but Section 5 Rule 5 requires that a single logical action spanning multiple tables (here: one `event_series` row + up to 52 `events` rows) be one atomic `SECURITY DEFINER` function, never split across multiple client-side calls, since a failure partway through N separate HTTP calls would leave a half-created series with no way to roll back. Proposed resolution for this DIP: implement one `create_event_series_with_audit()` `SECURITY DEFINER` function that inserts the `event_series` row and all N `events` rows in a single transaction, replicating the same validation `createEvent()`/`insert_event_with_audit()` already perform (event-type validity, talk-id validity per the same rules `validateTalkIdForEvent` enforces, datetime ordering) inline in that function — satisfying "same validation, same outcome" in substance without literally invoking the TS function N times over the network. If this reading doesn't match the intent, flag it back rather than building it silently.
- FP-68 explicitly does NOT get the same atomicity treatment, and that's correct as written — its AC explicitly says "not a new bulk-write mechanism," reusing FP-65's per-event `cancel_event_with_audit()` call in a loop. This is acceptable here (unlike FP-63's creation batch) because a partial bulk-cancel leaves no inconsistent state — each individual cancel is already atomic on its own, and "some of N cancelled, rerun for the rest" is a safe partial-failure mode, unlike a half-created series.
- Ambiguity in the AC, resolved with an explicit assumption — confirm before building: the AC lists `day_of_week` as an `event_series` column without specifying how the admin sets it. This DIP assumes the admin sets the first occurrence's start/end datetime directly (reusing the same fields as single-event creation), and `day_of_week` is derived and stored automatically from that date, for display/reference only — not a separate picker. Monthly recurrence advances by calendar month on the same day-of-month as the first occurrence, clamped to the last day of the month where it doesn't exist (e.g. Jan 31 → Feb 28); Weekly/Fortnightly advance by fixed 7/14-day intervals. If the intended UX is a standalone day-of-week picker independent of a specific first date, that's a different design — flag it rather than building this default silently.
- The "ends on date" cap-validation math and the actual occurrence-date generation must be the same code path, not two independent implementations that could disagree — compute occurrence dates once (shared function), use it both to count (for cap validation, before generation) and to generate (the actual insert loop).
- Schema verification required before writing anything — do not assume from this DIP, both `createEvent()`/`insert_event_with_audit()` and `cancel_event_with_audit()` changed in the just-merged Core Admin Surface DIP:
  - Confirm the current live signature of `insert_event_with_audit()` (now includes `p_location_address`/`p_location_url` per PR #49) before replicating its insert logic inside the new series-creation function.
  - Confirm `cancel_event_with_audit()`'s current body (fixed for the LOCKED-check bug and the ambiguous-column bug in PR #49) — FP-68's loop should call the TypeScript `cancelEvent()` service function as-is, not reimplement its logic.
  - Confirm `get_event_effective_status()`'s exact return values — FP-68 needs to select events whose effective status is not yet `COMPLETED`/`LOCKED` and not already `CANCELLED`.
  - Confirm the current `EventForm.tsx` structure (Create/Edit shared component from the Core Admin Surface DIP) before extending it — the "repeats" option applies to Create mode only, never Edit (individual occurrences are edited normally afterward, not as a series).
- Cross-tenant safety: `event_series` is a new tenant-scoped table. `events.recurrence_series_id` is a new FK from an existing tenant-scoped table into this one — standard cross-tenant trigger treatment applies: any event's `recurrence_series_id` must point to a series belonging to the same tenant.
- Canonical error codes: reuse `VALIDATION_ERROR` for cap violations (don't invent `OCCURRENCE_CAP_EXCEEDED`); reuse `INVALID_STATE_TRANSITION` for FP-68's per-event cancel-blocked cases, matching FP-65 exactly.
- Migration idempotency applies as usual.

### Implementation Plan
Phase 0 — Grounding
1. Branch off `dev`.
2. Read every function/file listed in the Grounding Check live. Confirm the current `EventForm.tsx`, `insert_event_with_audit()`, `cancel_event_with_audit()`, and `get_event_effective_status()` before writing anything — several changed in the immediately-preceding DIP.

Phase 1 — Migration: `event_series` table + FK + atomic creation function
3. New table `event_series`: `id, tenant_id, frequency ('WEEKLY'|'FORTNIGHTLY'|'MONTHLY'), occurrence_count, day_of_week (derived, stored for display), created_by, created_at`, plus the template fields copied onto each generated occurrence (`name, event_type_id, location_name, location_address, location_url, target, talk_id`).
4. `events.recurrence_series_id` — nullable FK to `event_series(id)`, plus the standard `BEFORE INSERT OR UPDATE` cross-tenant validation trigger.
5. `create_event_series_with_audit()` — `SECURITY DEFINER` function: validates the requested occurrence count against the applicable cap (Weekly 52 / Fortnightly 26 / Monthly 12 — cap is a ceiling the admin can choose up to, never a forced default), inserts the `event_series` row, then loops to insert exactly the chosen number of `events` rows (each `DRAFT`, `recurrence_series_id` set, all template fields copied), writing one `event`/`create` audit entry per generated occurrence — all inside one transaction.

Phase 2 — Occurrence date generation (single-sourced)
6. Implement occurrence-date computation once — used identically for (a) computing the implied count when the admin uses "ends on date" (for cap validation, before generation) and (b) generating the actual per-occurrence `start_datetime`/`end_datetime` values. Do not implement this twice.

Phase 3 — FP-63 UI: extend `EventForm.tsx` (Create mode only)
7. Add a "Repeats" toggle. When enabled: frequency select, then either "repeat N times" (numeric input, capped) or "ends on [date]" (date input, with the implied count shown/validated client-side before submit using the same logic as Phase 2 — a live estimate, final validation still happens server-side).
8. Submit via a new `POST /api/event-series` call instead of `POST /api/events` when "Repeats" is enabled.

Phase 4 — `POST /api/event-series` route
9. Admin only, `actorMemberId` derived server-side from `ctx.memberId` (never client body, per the established pattern). Calls `create_event_series_with_audit()`.

Phase 5 — FP-68: bulk-cancel remaining occurrences
10. New service function `cancelRemainingInSeries(seriesId, tenantId, actorMemberId)`: select every event with that `recurrence_series_id`, tenant-scoped, where effective status is not `COMPLETED`/`LOCKED` and status is not already `CANCELLED`; loop calling the existing `cancelEvent()` service function per row (reuse, not a new write path, per the AC). Collect results — return counts of cancelled vs. skipped, and any individual failures, rather than failing the whole batch on one bad row.
11. New route `POST /api/event-series/[id]/cancel-remaining`, Admin only.

Phase 6 — Minimal supporting UI (flagged, not separately ticketed — same pattern as the Event Detail screen in the prior DIP)
12. On the Event Detail screen (`EventDetail.tsx`), for any event with a non-null `recurrence_series_id`: show a "Part of a recurring series" indicator and a "Cancel remaining occurrences in this series" button (with a confirmation dialog, since this is irreversible and affects multiple events at once — stronger warning copy than the single-event cancel confirmation).

Phase 7 — Regression
13. Confirm both prior event-related regression suites still pass unmodified.
14. Add new coverage: cap enforcement for both input methods (including the boundary — exactly-at-cap succeeds, one-over-cap rejected); "ends on date" implied-count math matches actual generated occurrence count exactly; occurrence independence (editing/cancelling one occurrence doesn't touch others in the same series); cross-tenant safety on `recurrence_series_id`; FP-68 selectivity (a `COMPLETED` or already-`CANCELLED` occurrence in the series is left untouched, only eligible future occurrences are cancelled).

### Files to Create/Modify
- `supabase/migrations/[next]_event_series.sql` (new) — table, FK, cross-tenant trigger, `create_event_series_with_audit()`
- `app/api/event-series/route.ts` (new) — `POST`
- `app/api/event-series/[id]/cancel-remaining/route.ts` (new) — `POST`
- `src/features/events/event-series.service.ts` (new) — `createEventSeries()`, `cancelRemainingInSeries()`
- `src/features/events/event.types.ts` (modify — series types)
- `app/admin/(shell)/events/EventForm.tsx` (modify — Repeats UI, Create mode only)
- `app/admin/(shell)/events/[id]/EventDetail.tsx` (modify — series indicator + cancel-remaining action)

### Migration Files (if applicable)
```sql
-- DIP-FP-63-68: recurring event series

CREATE TABLE IF NOT EXISTS event_series (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    frequency TEXT NOT NULL CHECK (frequency IN ('WEEKLY', 'FORTNIGHTLY', 'MONTHLY')),
    occurrence_count INT NOT NULL,
    day_of_week INT, -- derived from first occurrence's start_datetime, display only
    created_by UUID,
    name TEXT NOT NULL,
    event_type_id UUID NOT NULL,
    location_name TEXT NOT NULL,
    location_address TEXT NOT NULL,
    location_url TEXT,
    target JSONB NOT NULL,
    talk_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE events ADD COLUMN IF NOT EXISTS recurrence_series_id UUID REFERENCES event_series(id);

-- Cross-tenant safety: an event's recurrence_series_id must belong to the same tenant.
CREATE OR REPLACE FUNCTION public.validate_event_series_tenant_scope()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  IF NEW.recurrence_series_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM event_series WHERE id = NEW.recurrence_series_id AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'events.recurrence_series_id % does not belong to tenant %', NEW.recurrence_series_id, NEW.tenant_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_validate_event_series_tenant_scope ON events;
CREATE TRIGGER trigger_validate_event_series_tenant_scope
BEFORE INSERT OR UPDATE ON events
FOR EACH ROW EXECUTE FUNCTION validate_event_series_tenant_scope();

-- create_event_series_with_audit(): illustrative structure only — CC must confirm the live
-- insert_event_with_audit() column set (location_address/location_url now included per PR #49)
-- before finalizing the per-occurrence INSERT below, and must implement the actual occurrence-
-- date generation loop (Phase 2) rather than the placeholder shown here.
CREATE OR REPLACE FUNCTION public.create_event_series_with_audit(
    p_tenant_id UUID,
    p_frequency TEXT,
    p_occurrence_dates JSONB, -- array of {start_datetime, end_datetime} pairs, precomputed by caller per Phase 2
    p_name TEXT,
    p_event_type_id UUID,
    p_location_name TEXT,
    p_location_address TEXT,
    p_location_url TEXT,
    p_target JSONB,
    p_talk_id UUID,
    p_actor_member_id UUID
)
RETURNS TABLE (series_id UUID, event_ids UUID[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_series_id UUID;
  v_event_ids UUID[] := '{}';
  v_occurrence JSONB;
  v_event_row events%ROWTYPE;
  v_count INT;
  v_cap INT;
BEGIN
  v_count := jsonb_array_length(p_occurrence_dates);
  v_cap := CASE p_frequency WHEN 'WEEKLY' THEN 52 WHEN 'FORTNIGHTLY' THEN 26 WHEN 'MONTHLY' THEN 12 END;
  IF v_count > v_cap THEN
    RAISE EXCEPTION 'occurrence_count % exceeds cap % for frequency %', v_count, v_cap, p_frequency;
  END IF;

  INSERT INTO event_series (
    tenant_id, frequency, occurrence_count, day_of_week, created_by,
    name, event_type_id, location_name, location_address, location_url, target, talk_id
  ) VALUES (
    p_tenant_id, p_frequency, v_count,
    EXTRACT(DOW FROM (p_occurrence_dates->0->>'start_datetime')::TIMESTAMPTZ)::INT,
    p_actor_member_id,
    p_name, p_event_type_id, p_location_name, p_location_address, p_location_url, p_target, p_talk_id
  )
  RETURNING id INTO v_series_id;

  FOR v_occurrence IN SELECT * FROM jsonb_array_elements(p_occurrence_dates)
  LOOP
    INSERT INTO events (
      tenant_id, event_type_id, name, status, start_datetime, end_datetime,
      location_name, location_address, location_url, target, talk_id, recurrence_series_id
    ) VALUES (
      p_tenant_id, p_event_type_id, p_name, 'DRAFT',
      (v_occurrence->>'start_datetime')::TIMESTAMPTZ, (v_occurrence->>'end_datetime')::TIMESTAMPTZ,
      p_location_name, p_location_address, p_location_url, p_target, p_talk_id, v_series_id
    )
    RETURNING * INTO v_event_row;

    PERFORM write_audit_log(p_tenant_id, 'event', v_event_row.id, 'create', p_actor_member_id, NULL, to_jsonb(v_event_row));
    v_event_ids := array_append(v_event_ids, v_event_row.id);
  END LOOP;

  RETURN QUERY SELECT v_series_id, v_event_ids;
END;
$$;
```

### Branch Name
`feature/FP-63-68-recurring-series`

### Commit Message
`FP-63-FP-68: Recurring event series creation and bulk-cancel remaining occurrences`

### Pull Request Description
- FP-63: Recurring series creation extending the Create Event screen — Weekly/Fortnightly/Monthly, "repeat N times" or "ends on date," cap enforced as a ceiling (not a default), all occurrences generated atomically in one transaction.
- FP-68: Bulk-cancel remaining occurrences in a series, reusing FP-65's per-event cancel path — past/completed occurrences untouched, irreversible.
- Note explicitly: the atomicity-vs-"same create path" tension (Grounding Check) and how it was resolved; the day-of-week/date-input assumption and its rationale; confirmation that occurrence-count validation and generation share one code path.

### Jira Linkage
- PDEEpicID: FP-11 (EPIC-3 — Event Lifecycle Management)
- PDEStoryID: FP-63, FP-68

### Stop Point
Save this DIP verbatim to `documentation/dips/DIP-FP-63-FP-68.md` and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against `dev` and stop. Do not merge — the user will merge once Atlas has reviewed the diffs and confirmed the PR looks good; testing happens afterward against the deployed `dev` environment.
Include full diffs for every file in your completion report — not a summary.
