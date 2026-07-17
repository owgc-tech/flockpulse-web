-- FP-134: tenant-wide RSVP nudge day-offsets (web half — Community Settings config).
-- Mobile half (DIP-FP-132-FP-133-FP-134-mobile) consumes these via GET /api/tenant/settings.

ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS rsvp_nudge_days_1 INTEGER NOT NULL DEFAULT 7,
    ADD COLUMN IF NOT EXISTS rsvp_nudge_days_2 INTEGER NOT NULL DEFAULT 5,
    ADD COLUMN IF NOT EXISTS rsvp_nudge_days_3 INTEGER NOT NULL DEFAULT 3;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_rsvp_nudge_days_1_check'
  ) THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_rsvp_nudge_days_1_check
      CHECK (rsvp_nudge_days_1 >= 0 AND rsvp_nudge_days_1 <= 90);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_rsvp_nudge_days_2_check'
  ) THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_rsvp_nudge_days_2_check
      CHECK (rsvp_nudge_days_2 >= 0 AND rsvp_nudge_days_2 <= 90);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_rsvp_nudge_days_3_check'
  ) THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_rsvp_nudge_days_3_check
      CHECK (rsvp_nudge_days_3 >= 0 AND rsvp_nudge_days_3 <= 90);
  END IF;
END $$;
