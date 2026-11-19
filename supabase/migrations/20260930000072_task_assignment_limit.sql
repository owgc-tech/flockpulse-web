-- FP-220: per-tenant cap on how many groups/individuals (combined) can be
-- assigned to a non-individual_only task. Mirrors rsvp_closure_days_default's
-- exact idempotent ADD COLUMN + DO-block CHECK pattern (20260717000044).

ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS task_assignment_limit INTEGER NOT NULL DEFAULT 5;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_task_assignment_limit_check'
  ) THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_task_assignment_limit_check
      CHECK (task_assignment_limit >= 1 AND task_assignment_limit <= 50);
  END IF;
END $$;
