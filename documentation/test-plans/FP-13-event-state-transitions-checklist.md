# FP-13 Event State Transitions — Test Checklist

Story: STORY-3.2 — Automatic Event Lifecycle Transitions
Migration: 20260629000005_event_state_transitions.sql
Epic: FP-11 (EPIC-3 — Event Lifecycle Management)

Resolves PIB OQ-1: attendance window is tenant-configurable (attendance_window_hours, default 24),
anchored at event.end_datetime.

---

## Schema Verification

- [ ] **tenants.attendance_window_hours column exists with default 24**
  ```sql
  SELECT attendance_window_hours FROM tenants LIMIT 1;
  ```
  Confirm column is present and existing rows have value 24.

- [ ] **event_notifications.status accepts CANCELLED**
  ```sql
  -- Should succeed without constraint violation:
  UPDATE event_notifications SET status = 'CANCELLED' WHERE id = '<any-pending-id>';
  ```

- [ ] **pg_cron job is registered on the expected schedule**
  ```sql
  SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'transition-event-states';
  ```
  Expected: one row, schedule = `*/5 * * * *`, command = `SELECT public.transition_event_states();`

- [ ] **transition_event_states() function exists and is SECURITY DEFINER**
  ```sql
  SELECT proname, prosecdef, proconfig FROM pg_proc
  WHERE proname = 'transition_event_states' AND pronamespace = 'public'::regnamespace;
  ```
  Confirm `prosecdef = true` and `proconfig` includes `search_path=public,pg_catalog`.

- [ ] **block_actions_on_cancelled_or_locked() function exists**
  ```sql
  SELECT proname FROM pg_proc
  WHERE proname = 'block_actions_on_cancelled_or_locked' AND pronamespace = 'public'::regnamespace;
  ```

- [ ] **trigger_suppress_notifications_on_cancel trigger exists on events**
  ```sql
  SELECT tgname FROM pg_trigger WHERE tgname = 'trigger_suppress_notifications_on_cancel';
  ```

---

## State Transition Correctness

Run all transition tests by calling `SELECT public.transition_event_states();` directly — do not
wait for the 5-minute cron tick.

- [ ] **SCHEDULED → ACTIVE**
  - Insert event with status = 'SCHEDULED', start_datetime = now() - INTERVAL '1 minute'.
  - Call `SELECT public.transition_event_states();`
  - Verify event.status = 'ACTIVE', updated_at changed.

- [ ] **ACTIVE → COMPLETED**
  - Insert event with status = 'ACTIVE', end_datetime = now() - INTERVAL '1 minute'.
  - Call `SELECT public.transition_event_states();`
  - Verify event.status = 'COMPLETED'.

- [ ] **COMPLETED → LOCKED (default 24h window)**
  - Tenant has attendance_window_hours = 24 (default).
  - Insert event with status = 'COMPLETED', end_datetime = now() - INTERVAL '25 hours'.
  - Call `SELECT public.transition_event_states();`
  - Verify event.status = 'LOCKED'.

- [ ] **COMPLETED → LOCKED does NOT fire before window closes**
  - Tenant has attendance_window_hours = 24.
  - Insert event with status = 'COMPLETED', end_datetime = now() - INTERVAL '23 hours'.
  - Call `SELECT public.transition_event_states();`
  - Verify event.status remains 'COMPLETED'.

- [ ] **Non-default attendance_window_hours is respected**
  - Set tenant attendance_window_hours = 6 via `PATCH /api/tenant/settings`.
  - Insert COMPLETED event with end_datetime = now() - INTERVAL '7 hours'.
  - Call `SELECT public.transition_event_states();`
  - Verify event.status = 'LOCKED'.
  - Confirm a second tenant with default (24h) is NOT locked with the same end_datetime offset.

- [ ] **Cascade: missed cron run — event traverses multiple states in one pass**
  - Insert event with status = 'SCHEDULED',
    start_datetime = now() - INTERVAL '50 hours',
    end_datetime = now() - INTERVAL '26 hours'.
    Tenant attendance_window_hours = 24.
  - Call `SELECT public.transition_event_states();` once.
  - Verify event.status = 'LOCKED' (cascaded through ACTIVE → COMPLETED → LOCKED in a single
    function call, not stuck at ACTIVE requiring the next tick).

- [ ] **Tenant isolation: only events belonging to the tenant transition**
  - Two tenants, each with a SCHEDULED event past start_datetime.
  - Call transition_event_states().
  - Verify both events transition independently using their own tenant's attendance_window_hours.

---

## Cancelled Event — Notification Suppression

- [ ] **PENDING notifications cancelled when event is cancelled**
  - Event with 2 PENDING and 1 RETRYING notification.
  - UPDATE events SET status = 'CANCELLED' WHERE id = '<event-id>';
  - Verify all 3 event_notifications rows have status = 'CANCELLED'.

- [ ] **Already-SENT/FAILED notifications are untouched by cancellation**
  - Event with 1 SENT and 1 FAILED notification plus 1 PENDING.
  - UPDATE events SET status = 'CANCELLED'.
  - Verify: PENDING → CANCELLED; SENT stays SENT; FAILED stays FAILED.

- [ ] **Cancelling an already-CANCELLED event is idempotent**
  - UPDATE events SET status = 'CANCELLED' twice.
  - No error, no duplicate suppression, notification statuses unchanged on second update.

---

## block_actions_on_cancelled_or_locked() Guard

Note: this function is unit-testable directly against the DB. End-to-end integration testing
(RSVP, self-report, confirmation endpoint blocking) is NOT possible in this PR because those
endpoints (EPIC-4, EPIC-5, EPIC-6) do not yet exist. Future PR authors must call this function
and return 422 INVALID_STATE when it returns TRUE.

- [ ] **Returns TRUE for CANCELLED event**
  ```sql
  SELECT public.block_actions_on_cancelled_or_locked('<cancelled-event-id>');
  -- Expected: true
  ```

- [ ] **Returns TRUE for LOCKED event**
  ```sql
  SELECT public.block_actions_on_cancelled_or_locked('<locked-event-id>');
  -- Expected: true
  ```

- [ ] **Returns FALSE for DRAFT event**
  ```sql
  SELECT public.block_actions_on_cancelled_or_locked('<draft-event-id>');
  -- Expected: false
  ```

- [ ] **Returns FALSE for SCHEDULED event**
  - Expected: false

- [ ] **Returns FALSE for ACTIVE event**
  - Expected: false

- [ ] **Returns FALSE for COMPLETED event**
  - Expected: false (window still open — RSVP/self-report/confirmation still allowed)

- [ ] **Returns FALSE for non-existent event ID**
  - Expected: false (EXISTS returns false, no error)

---

## Tenant Settings API

- [ ] **GET /api/tenant/settings → returns attendance_window_hours**
  - Admin JWT. Verify response includes attendance_window_hours.

- [ ] **PATCH /api/tenant/settings with attendanceWindowHours = 6 → updates and returns new value**
  - Admin JWT, body: `{ "attendanceWindowHours": 6 }`.
  - Expected: 200, response data.attendance_window_hours = 6.

- [ ] **PATCH with attendanceWindowHours = 0 → INVALID_VALUE**
  - Expected: 422, code = 'INVALID_VALUE'.

- [ ] **PATCH with attendanceWindowHours = 721 → INVALID_VALUE**
  - Expected: 422, code = 'INVALID_VALUE'. (Upper bound is 720h = 30 days.)

- [ ] **PATCH with attendanceWindowHours = 1.5 (non-integer) → INVALID_VALUE**
  - Expected: 422, code = 'INVALID_VALUE'.

- [ ] **PATCH by non-Admin → FORBIDDEN_ROLE**
  - Member or Leader JWT. Expected: 403.

- [ ] **GET by any authenticated tenant member → 200**
  - Settings are readable by all authenticated members, not Admin-only.

---

## pg_cron Operational Notes (manual pre-checks before production deploy)

- pg_cron is available in Supabase Pro tier and above; confirm your remote project's plan before
  applying migration 000005 to production.
- The `cron.schedule()` call inside the migration is idempotent by job name — re-running on reset
  updates rather than duplicates.
- On remote Supabase, the pg_cron daemon runs as the `postgres` role. The scheduled command
  `SELECT public.transition_event_states();` will execute as that role — SECURITY DEFINER on
  the function ensures it runs with the function owner's privileges, not the caller's.
