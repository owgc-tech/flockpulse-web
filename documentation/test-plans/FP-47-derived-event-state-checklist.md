# FP-47 Test Checklist — Derived Event State

## 1. No cron job registered

```sql
SELECT COUNT(*) FROM cron.job WHERE jobname = 'transition-event-states';
-- Expected: 0
```

## 2. transition_event_states() removed

```sql
SELECT COUNT(*) FROM pg_proc WHERE proname = 'transition_event_states';
-- Expected: 0
```

## 3. events.status CHECK tightened

```sql
-- ACTIVE should now be rejected as a stored value
INSERT INTO events (..., status) VALUES (..., 'ACTIVE');
-- Expected: ERROR — check constraint events_status_check violated

INSERT INTO events (..., status) VALUES (..., 'COMPLETED');
-- Expected: ERROR — check constraint events_status_check violated

INSERT INTO events (..., status) VALUES (..., 'LOCKED');
-- Expected: ERROR — check constraint events_status_check violated
```

## 4. get_event_effective_status() — boundary correctness

Given a SCHEDULED event with known start_datetime / end_datetime / attendance_window_hours:

```sql
-- Before start_datetime
SELECT get_event_effective_status('<event_id>');  -- Expected: 'SCHEDULED'

-- After start_datetime, before end_datetime
SELECT get_event_effective_status('<event_id>');  -- Expected: 'ACTIVE'

-- After end_datetime, within attendance window
SELECT get_event_effective_status('<event_id>');  -- Expected: 'COMPLETED'

-- After end_datetime + attendance_window_hours
SELECT get_event_effective_status('<event_id>');  -- Expected: 'LOCKED'
```

The key test is at the exact moment `end_datetime` passes — there is no 5-minute lag; the
status transitions from ACTIVE to COMPLETED instantaneously on the next call.

## 5. DRAFT and CANCELLED pass through unchanged

```sql
SELECT get_event_effective_status('<draft_event_id>');    -- Expected: 'DRAFT'
SELECT get_event_effective_status('<cancelled_event_id>');-- Expected: 'CANCELLED'
```

## 6. Non-existent event ID → NULL (not an error)

```sql
SELECT get_event_effective_status('00000000-0000-0000-0000-000000000000');
-- Expected: NULL
```

## 7. block_actions_on_cancelled_or_locked() — FP-13 regression suite

All cases from the original FP-13 test checklist must continue to pass:

```sql
-- CANCELLED event → TRUE
SELECT block_actions_on_cancelled_or_locked('<cancelled_event_id>');  -- Expected: TRUE

-- LOCKED event (past end + attendance window) → TRUE
SELECT block_actions_on_cancelled_or_locked('<locked_event_id>');     -- Expected: TRUE

-- SCHEDULED event → FALSE
SELECT block_actions_on_cancelled_or_locked('<scheduled_event_id>');  -- Expected: FALSE

-- ACTIVE event → FALSE
SELECT block_actions_on_cancelled_or_locked('<active_event_id>');     -- Expected: FALSE

-- COMPLETED event → FALSE
SELECT block_actions_on_cancelled_or_locked('<completed_event_id>');  -- Expected: FALSE

-- Non-existent event ID → FALSE (not NULL — COALESCE regression guard)
SELECT block_actions_on_cancelled_or_locked('00000000-0000-0000-0000-000000000000');
-- Expected: FALSE  ← this is the critical regression case
```

## 8. RSVP — no staleness window

Submit an RSVP immediately after an event's `end_datetime` passes (before any old cron tick
would have fired). With FP-13, this would have returned `RSVP_CLOSED` for up to 5 minutes.
With FP-47, the status derives to ACTIVE while `now() < end_datetime`; once past, it derives
to COMPLETED and RSVP correctly returns `RSVP_CLOSED` — no polling lag.

## 9. Self-report — staleness bug fixed

Submit a self-report immediately after `end_datetime` passes. With FP-13, `events.status`
was still `ACTIVE` until the next cron tick, so the check `effectiveStatus !== 'COMPLETED'`
would have returned `SELF_REPORT_NOT_OPEN` for up to 5 minutes after the event ended.
With FP-47, `get_event_effective_status` derives `COMPLETED` the instant `now() >= end_datetime`,
so the self-report is accepted immediately.

## 10. handle_event_scheduling() unchanged

Confirm the function body and its trigger are byte-identical to before this migration:

```sql
SELECT prosrc FROM pg_proc WHERE proname = 'handle_event_scheduling';
-- Must match the version from migration 20260629000003 exactly — no diff.

SELECT tgname FROM pg_trigger WHERE tgname = 'trigger_event_scheduling';
-- Must still exist on the events table.
```
