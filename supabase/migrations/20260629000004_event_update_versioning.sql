-- DIP-FP-14: Event update with version tracking, talk_id immutability, notification reschedule


-- ==============================================================
-- SECTION 1: events — add version and talk_id columns
--
-- version: not present in 000002; added here. Starts at 1 for
--   all existing rows; incremented by the application layer on
--   every successful PATCH.
-- talk_id: not present in any prior migration; added here.
--   Nullable — events may exist without a linked Talk. Once any
--   event_notification has been dispatched (status != 'PENDING'),
--   talk_id becomes immutable; enforcement is at the app layer.
-- ==============================================================

ALTER TABLE events
    ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS talk_id UUID;


-- ==============================================================
-- SECTION 2: event_notifications — expand CHECK constraints
--
-- status: add RETRYING (for dispatch retry logic; needed so the
--   "recalculate unsent notifications" query can include retrying
--   rows alongside pending ones).
-- purpose: add EVENT_UPDATE (for the change notification inserted
--   on every successful event update, addressed to all expected
--   members). The prior CHECK only listed the three original
--   scheduling purposes.
-- ==============================================================

ALTER TABLE event_notifications DROP CONSTRAINT IF EXISTS event_notifications_status_check;
ALTER TABLE event_notifications
    ADD CONSTRAINT event_notifications_status_check
    CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'RETRYING'));

ALTER TABLE event_notifications DROP CONSTRAINT IF EXISTS event_notifications_purpose_check;
ALTER TABLE event_notifications
    ADD CONSTRAINT event_notifications_purpose_check
    CHECK (purpose IN (
        'PRE_EVENT_REMINDER',
        'POST_EVENT_SELF_REPORT',
        'LEADER_CONFIRMATION',
        'EVENT_UPDATE'
    ));


-- ==============================================================
-- SECTION 3: partial index on event_notifications(event_id, status)
--
-- Scoped to unsent rows (PENDING or RETRYING) only — the set the
-- app layer must query and update on every reschedule. Without
-- this index, a reschedule update scans all notification rows for
-- the event, including already-SENT rows that will never change.
-- ==============================================================

CREATE INDEX IF NOT EXISTS idx_event_notifications_unsent
    ON event_notifications(event_id, status)
    WHERE status IN ('PENDING', 'RETRYING');
