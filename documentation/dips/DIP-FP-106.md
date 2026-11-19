# DIP-FP-106

### Story Summary
Today, the only way to make an event recurring is to build it that way from the start via the Create Event screen (FP-63). This story adds the missing reverse path: from the Edit Event screen, an admin can take an existing, already-created single event that doesn't yet belong to any series and turn it into the first occurrence of a brand-new series. The existing event keeps all its own fields exactly as they are — this is an attachment to a new series, not a content edit — and N-1 additional sibling events are generated using it as the template, reusing FP-63's atomic creation pattern, cap rules, and single-sourced date math exactly. This does not reopen FP-63's "no bulk edit" decision: it creates a new series from one existing event, it does not add any way to bulk-edit an existing series's occurrences.

### Repo Target
Web (Next.js) — extends the existing Edit Event screen in `owgc-tech/flockpulse-web`.

### Grounding Check
- No Section 4 invariant conflicts. Same category as FP-63/FP-68 — event lifecycle/scheduling, no RSVP/self-report/attendance/formation-completion logic touched.
- Reuse, don't reimplement — confirm all of the following live before writing anything, since this directly extends work from the last two merged DIPs:
  - `create_event_series_with_audit()`'s current body (Foundation for the pattern this new function mirrors).
  - `computeOccurrenceDates()` in `event.types.ts` — this story reuses it exactly, but with an off-by-one nuance: index 0 of the computed sequence corresponds to the existing event's own (unchanged) dates, so only indices 1..N-1 are the new sibling occurrences to generate. Get this slicing right and cover it with a dedicated test — an off-by-one here would either drop an occurrence or duplicate the existing event's exact time slot.
  - `trigger_validate_event_series_tenant_scope` — confirm live that it fires on both `BEFORE INSERT OR UPDATE`, not insert-only. If it does (as built in DIP-FP-63-FP-68), setting `recurrence_series_id` on the existing event via a plain `UPDATE` gets the cross-tenant check for free — no new trigger needed for this story.
  - `get_event_effective_status()`'s exact return values — this story needs to gate on effective status, not raw `status`.
  - Confirm `EventForm.tsx`'s current Edit-mode structure and confirm `EventDetailRow` (already includes `effective_status` and `recurrence_series_id`, per the last two DIPs) is what's passed as `initialEvent` — the UI gating (`recurrence_series_id IS NULL` and eligible effective status) can be done entirely from props already available, no new data-fetching needed.
- Atomicity, same reasoning as FP-63: creating a new `event_series` row + N-1 new `events` rows + updating the original event's `recurrence_series_id`, all as one logical action, must be one `SECURITY DEFINER` transaction — a partial failure must not leave the original event half-attached to a series that doesn't fully exist.
- Eligibility rules, both must be enforced server-side, not just hidden client-side: (a) `recurrence_series_id` must currently be `NULL` on the target event — reject otherwise, don't silently allow re-attachment; (b) effective status must not be `CANCELLED`/`COMPLETED`/`LOCKED` — reject otherwise. Client-side hiding of the UI option is a UX nicety, not the actual guard.
- Cross-tenant safety: the existing event, tenant-checked as always; the new `event_series` row inherits the same tenant; no new cross-tenant surface beyond what FP-63's migration already covers.
- Canonical error codes: reuse `VALIDATION_ERROR` for cap violations and for the "already in a series" rejection; reuse `INVALID_STATE_TRANSITION` for the ineligible-status rejection, matching the vocabulary FP-65/FP-68 already established for state-blocked actions.
- Migration idempotency applies as usual — this is one new function, no new tables (the `event_series` table and `recurrence_series_id` column already exist from FP-63).

### Implementation Plan
Phase 0 — Grounding
1. Branch off `dev`. Confirm every item in the Grounding Check live before writing code.

Phase 1 — Migration: `convert_event_to_series_with_audit()`
2. New `SECURITY DEFINER` function: fetch the target event (tenant-scoped); raise if not found; raise if `recurrence_series_id IS NOT NULL`; raise if effective status is `CANCELLED`/`COMPLETED`/`LOCKED`; validate total occurrence count (1 + additional occurrences) against the applicable cap; insert the `event_series` row using the existing event's fields as template; loop-insert the additional sibling `events` rows (same shape as `create_event_series_with_audit()`'s loop); `UPDATE` the original event setting only `recurrence_series_id`; write one `event`/`update` audit entry for the original event and one `event`/`create` audit entry per new sibling — all in one transaction.

Phase 2 — Service layer
3. New `convertEventToSeries()` in `event-series.service.ts`: accepts the existing event's id, its own current `start_datetime`/`end_datetime` (needed to compute the full occurrence sequence), frequency, mode, and count/until — computes the full sequence via `computeOccurrenceDates()`, slices off index 0 (the existing event, unchanged), passes only the remaining occurrences to the new RPC.

Phase 3 — API route
4. New route `POST /api/events/[id]/convert-to-series`, Admin only, `actorMemberId` derived server-side from `ctx.memberId` per the established pattern.

Phase 4 — UI: extend `EventForm.tsx` (Edit mode only, conditionally)
5. When `isEdit` and `initialEvent.recurrence_series_id` is `null` and `initialEvent.effective_status` is not `CANCELLED`/`COMPLETED`/`LOCKED`: show a "Make this a recurring series" toggle, reusing the exact same frequency/mode/count/until UI FP-63 already built for Create mode (factor out as a shared sub-component if that's cleaner than duplicating the JSX — CC's call, but don't diverge the behavior). Submits to the new route instead of the normal `PATCH`.
6. When the event already has a `recurrence_series_id`, or is in an ineligible status, this section simply doesn't render — no error state needed, it's not a reachable action from the UI at that point.

Phase 5 — Regression
7. Confirm all four prior event-related regression suites still pass unmodified.
8. New coverage: the off-by-one slicing (existing event's own dates are untouched, exactly N-1 new siblings generated, no duplicate time slot); rejecting an event that already has a `recurrence_series_id`; rejecting an event whose effective status is `CANCELLED`/`COMPLETED`/`LOCKED`; cap enforcement on the total (1 + additional) count; confirming the original event's other fields (name, location, target, etc.) are byte-for-byte unchanged after conversion — only `recurrence_series_id` differs.

### Files to Create/Modify
- `supabase/migrations/[next]_convert_event_to_series.sql` (new) — `convert_event_to_series_with_audit()`
- `app/api/events/[id]/convert-to-series/route.ts` (new)
- `src/features/events/event-series.service.ts` (modify — `convertEventToSeries()`)
- `app/admin/(shell)/events/EventForm.tsx` (modify — conditional "Make this a recurring series" section in Edit mode)

### Migration Files (if applicable)
```sql
-- DIP-FP-106: convert an existing single event into the first occurrence of a new series

CREATE OR REPLACE FUNCTION public.convert_event_to_series_with_audit(
    p_event_id UUID,
    p_tenant_id UUID,
    p_frequency TEXT,
    p_additional_occurrence_dates JSONB, -- array of {start_datetime, end_datetime} for the NEW siblings only (existing event's own dates are untouched)
    p_actor_member_id UUID
)
RETURNS TABLE (series_id UUID, event_ids UUID[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_event events%ROWTYPE;
  v_effective_status TEXT;
  v_series_id UUID;
  v_event_ids UUID[];
  v_occurrence JSONB;
  v_new_row events%ROWTYPE;
  v_before JSONB;
  v_total_count INT;
  v_cap INT;
BEGIN
  SELECT * INTO v_event FROM events WHERE id = p_event_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event % not found for tenant %', p_event_id, p_tenant_id;
  END IF;

  IF v_event.recurrence_series_id IS NOT NULL THEN
    RAISE EXCEPTION 'event % already belongs to a series', p_event_id;
  END IF;

  v_effective_status := public.get_event_effective_status(p_event_id);
  IF v_effective_status IN ('CANCELLED', 'COMPLETED', 'LOCKED') THEN
    RAISE EXCEPTION 'event % cannot be converted to a series from status %', p_event_id, v_effective_status;
  END IF;

  v_total_count := 1 + jsonb_array_length(p_additional_occurrence_dates);
  v_cap := CASE p_frequency WHEN 'WEEKLY' THEN 52 WHEN 'FORTNIGHTLY' THEN 26 WHEN 'MONTHLY' THEN 12 ELSE NULL END;
  IF v_cap IS NULL THEN
    RAISE EXCEPTION 'frequency must be WEEKLY, FORTNIGHTLY, or MONTHLY';
  END IF;
  IF v_total_count > v_cap THEN
    RAISE EXCEPTION 'total occurrence_count % exceeds cap % for frequency %', v_total_count, v_cap, p_frequency;
  END IF;

  -- Template fields come from the existing event, unchanged.
  INSERT INTO event_series (
    tenant_id, frequency, occurrence_count, day_of_week, created_by,
    name, event_type_id, location_name, location_address, location_url, target, talk_id
  ) VALUES (
    p_tenant_id, p_frequency, v_total_count, EXTRACT(DOW FROM v_event.start_datetime)::INT, p_actor_member_id,
    v_event.name, v_event.event_type_id, v_event.location_name, v_event.location_address,
    v_event.location_url, v_event.target, v_event.talk_id
  )
  RETURNING id INTO v_series_id;

  v_event_ids := ARRAY[p_event_id]; -- original event is occurrence 1 of the series

  FOR v_occurrence IN SELECT * FROM jsonb_array_elements(p_additional_occurrence_dates)
  LOOP
    INSERT INTO events (
      tenant_id, event_type_id, name, status, start_datetime, end_datetime,
      location_name, location_address, location_url, target, talk_id, recurrence_series_id
    ) VALUES (
      p_tenant_id, v_event.event_type_id, v_event.name, 'DRAFT',
      (v_occurrence->>'start_datetime')::TIMESTAMPTZ, (v_occurrence->>'end_datetime')::TIMESTAMPTZ,
      v_event.location_name, v_event.location_address, v_event.location_url, v_event.target, v_event.talk_id, v_series_id
    )
    RETURNING * INTO v_new_row;

    PERFORM write_audit_log(p_tenant_id, 'event', v_new_row.id, 'create', p_actor_member_id, NULL, to_jsonb(v_new_row));
    v_event_ids := array_append(v_event_ids, v_new_row.id);
  END LOOP;

  -- Attach the original event to the new series — only recurrence_series_id changes.
  v_before := to_jsonb(v_event);
  UPDATE events SET recurrence_series_id = v_series_id, updated_at = now()
  WHERE events.id = p_event_id AND events.tenant_id = p_tenant_id;

  PERFORM write_audit_log(
    p_tenant_id, 'event', p_event_id, 'update', p_actor_member_id,
    v_before, (SELECT to_jsonb(e) FROM events e WHERE e.id = p_event_id)
  );

  RETURN QUERY SELECT v_series_id, v_event_ids;
END;
$$;
```

(CC: confirm the live `events`/`event_series` column sets before finalizing — both were correct as of DIP-FP-63-FP-68's grounding, but re-verify.)

### Branch Name
`feature/FP-106-convert-event-to-series`

### Commit Message
`FP-106: Convert an existing single event into a new recurring series`

### Pull Request Description
- Maps to FP-106 AC: "Make this a recurring series" available on Edit for events with no existing `recurrence_series_id` and an eligible effective status; original event's fields (other than `recurrence_series_id`) unchanged; N-1 new siblings generated atomically; cap and date-math logic reused exactly from FP-63, no reimplementation.
- Explicitly note in the PR: this does not add any bulk-edit capability for existing series — confirmed distinct from FP-63's Design Decision.

### Jira Linkage
- PDEEpicID: FP-11 (EPIC-3 — Event Lifecycle Management)
- PDEStoryID: FP-106

### Stop Point
Save this DIP verbatim to `documentation/dips/DIP-FP-106.md` and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against `dev` and stop. Do not merge — the user will merge once Atlas has reviewed the diffs and confirmed the PR looks good; testing happens afterward against the deployed `dev` environment.
Include full diffs for every file in your completion report — not a summary.
