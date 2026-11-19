# FP-14 Event Update — Security & Correctness Test Checklist

Story: STORY-3.3 — Update Scheduled Event
Route: PATCH /api/events/:id
Epic: FP-11 (EPIC-3 — Event Lifecycle Management)

---

## Auth & Access Control

- [ ] **Non-Admin JWT → FORBIDDEN_ROLE**
  - Call PATCH /api/events/:id as a MEMBER or LEADER role.
  - Expected: 403 `{ error: { code: "FORBIDDEN_ROLE" } }`.

- [ ] **Missing/invalid JWT → AUTH_REQUIRED / INVALID_TOKEN**
  - Call with no Authorization header → 401 `AUTH_REQUIRED`.
  - Call with a malformed or expired token → 401 `INVALID_TOKEN`.

- [ ] **Cross-tenant update attempt → CROSS_TENANT_ACCESS**
  - Admin JWT for tenant A attempts to PATCH an event belonging to tenant B (using tenant B's event id).
  - Expected: 404 `NOT_FOUND` (event not found under tenant A's scope — not a 403 that leaks the event's existence).

---

## State Gating

- [ ] **Update on LOCKED event → INVALID_STATE**
  - Set event.status = 'LOCKED', then PATCH.
  - Expected: 422 `{ error: { code: "INVALID_STATE", message: "Cannot update event with status LOCKED" } }`.

- [ ] **Update on CANCELLED event → INVALID_STATE**
  - Set event.status = 'CANCELLED', then PATCH.
  - Expected: 422 `{ error: { code: "INVALID_STATE" } }`.

- [ ] **Update on DRAFT event → allowed**
  - A DRAFT event should be patchable (pre-publish editing).
  - Expected: 200, updated fields reflected, version incremented.

- [ ] **Update on SCHEDULED event → allowed**
  - A SCHEDULED event (the primary use case for this story) should be patchable.
  - Expected: 200, updated fields reflected, version incremented.

---

## Version Tracking

- [ ] **Every successful update increments version**
  - Create event (version = 1). PATCH name. Verify response has version = 2.
  - PATCH again. Verify response has version = 3.
  - Verify events row in DB reflects same version value.

---

## talk_id Immutability

- [ ] **Change talk_id before any notification dispatched → allowed**
  - Event has notifications all in status = 'PENDING'. PATCH with new talkId.
  - Expected: 200, talk_id updated.

- [ ] **Change talk_id after any notification dispatched → IMMUTABLE_FIELD**
  - Manually set one event_notification row to status = 'SENT'. PATCH with new talkId.
  - Expected: 422 `{ error: { code: "IMMUTABLE_FIELD" } }`.

- [ ] **Change talk_id after a FAILED notification → IMMUTABLE_FIELD**
  - Manually set one event_notification row to status = 'FAILED'. PATCH with new talkId.
  - Expected: 422 `IMMUTABLE_FIELD` (FAILED counts as dispatched — it was attempted).

- [ ] **Change talk_id after a RETRYING notification → IMMUTABLE_FIELD**
  - Manually set one event_notification row to status = 'RETRYING'. PATCH with new talkId.
  - Expected: 422 `IMMUTABLE_FIELD`.

- [ ] **Update non-talk_id fields after notifications dispatched → allowed**
  - Set a notification to 'SENT'. PATCH with only name changed (no talkId in body).
  - Expected: 200, name updated, version incremented. talk_id check not triggered.

---

## Datetime Validation

- [ ] **end_datetime <= start_datetime → INVALID_DATETIME**
  - PATCH with endDatetime set before or equal to startDatetime.
  - Expected: 422 `{ error: { code: "INVALID_DATETIME" } }`.

- [ ] **Partial datetime update: only startDatetime provided**
  - PATCH with only startDatetime. endDatetime defaults to current event value.
  - Expected: ordering check uses new start vs. existing end; succeeds if valid, fails if new start >= existing end.

---

## Notification Reschedule on Timing Change

- [ ] **Reschedule start_datetime → PRE_EVENT_REMINDER recalculated**
  - Event has PENDING PRE_EVENT_REMINDER scheduled for old_start - 24h.
  - PATCH new startDatetime. Verify the notification's scheduled_for = new_start - 24h.

- [ ] **Reschedule end_datetime → POST_EVENT_SELF_REPORT and LEADER_CONFIRMATION recalculated**
  - PATCH new endDatetime. Verify:
    - POST_EVENT_SELF_REPORT scheduled_for = new_end
    - LEADER_CONFIRMATION scheduled_for = new_end + 2h

- [ ] **Already-SENT notifications untouched by reschedule**
  - Manually set PRE_EVENT_REMINDER to status = 'SENT'. PATCH new startDatetime.
  - Expected: SENT row's scheduled_for is unchanged. Only PENDING/RETRYING rows are recalculated.

- [ ] **RETRYING notifications recalculated alongside PENDING**
  - Set PRE_EVENT_REMINDER to status = 'RETRYING'. PATCH new startDatetime.
  - Expected: RETRYING row's scheduled_for updated to new_start - 24h (same as PENDING treatment).

- [ ] **No timing change → no notification reschedule**
  - PATCH only name (no startDatetime or endDatetime). Verify no scheduled_for values change.

---

## EVENT_UPDATE Notification Insert

- [ ] **Successful update → EVENT_UPDATE notification per expected attendee**
  - Event with 3 attendees in event_attendees. Perform a PATCH.
  - Expected: 3 new event_notifications rows inserted with purpose = 'EVENT_UPDATE', status = 'PENDING'.

- [ ] **Event with no attendees → no EVENT_UPDATE rows inserted**
  - Event with zero event_attendees rows. Perform a PATCH.
  - Expected: no new event_notifications inserted; 200 still returned.

- [ ] **Multiple updates → multiple EVENT_UPDATE batches**
  - PATCH twice. Verify two separate sets of EVENT_UPDATE rows, each with distinct created_at.

---

## Schema Verification (migration 000004)

- [ ] **events.version column present and defaults to 1**
  - `SELECT version FROM events LIMIT 1;` — confirm column exists and existing rows have version = 1.

- [ ] **events.talk_id column present and nullable**
  - `SELECT talk_id FROM events LIMIT 1;` — confirm column exists, value is NULL for existing rows.

- [ ] **event_notifications.status accepts RETRYING**
  - `INSERT INTO event_notifications (..., status) VALUES (..., 'RETRYING');` — confirm no constraint violation.

- [ ] **event_notifications.purpose accepts EVENT_UPDATE**
  - `INSERT INTO event_notifications (..., purpose) VALUES (..., 'EVENT_UPDATE');` — confirm no constraint violation.

- [ ] **Partial index idx_event_notifications_unsent present**
  - `\d event_notifications` or `SELECT indexname FROM pg_indexes WHERE tablename = 'event_notifications';`
  - Confirm `idx_event_notifications_unsent` appears.
