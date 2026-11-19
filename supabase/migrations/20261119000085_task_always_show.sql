-- FP-261: per-task "Always show on events" setting.
--
-- Replaces the hardcoded CORE_TASK_NAMES list in EventForm.tsx
-- (['Prayer Leader', 'Food Assignment', 'Music']), which only worked for OWGC.
-- tasks.always_show = true makes a task appear automatically on every event
-- form, with no "Remove" button. Admins set it on the Tasks page.
--
-- OWGC's three tasks are switched on here so OWGC sees no change. Names are
-- matched exactly; soft-deleted rows with those names are also set (harmless:
-- deleted tasks are not listed). Idempotent: safe to run more than once.

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS always_show BOOLEAN NOT NULL DEFAULT false;

UPDATE tasks SET always_show = true
 WHERE name IN ('Prayer Leader', 'Food Assignment', 'Music') AND always_show = false;
