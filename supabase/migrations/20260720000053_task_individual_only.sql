-- DIP-FP-163: individual_only on the tasks catalog — restores the constraint Prayer
-- Leader had before Phase 3 (FP-161-3) unified every task onto one uniform picker.
-- When true, FP-162's GroupMemberChipPicker individualOnly prop excludes groups from
-- that task's assignee results entirely in EventForm.tsx's Tasks loop — this column is
-- just the stored per-task preference, enforcement itself is app-layer (the picker),
-- not a DB constraint on event_tasks_assignments.assignee.

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS individual_only BOOLEAN NOT NULL DEFAULT false;

UPDATE tasks SET individual_only = true WHERE name = 'Prayer Leader';
