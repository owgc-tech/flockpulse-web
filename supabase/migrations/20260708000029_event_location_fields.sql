-- DIP-FP-60-61-64-65-67, Phase 1: location fields
--
-- Confirmed live (both local dev and the real fpdb-dev remote environment, checked directly
-- by the user via the Supabase dashboard) that zero events rows exist anywhere — so the
-- backfill below is a formality with nothing to actually backfill, not a real data migration.

ALTER TABLE events ADD COLUMN IF NOT EXISTS location_address TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS location_url TEXT;

UPDATE events SET location_address = location_name WHERE location_address IS NULL;

ALTER TABLE events ALTER COLUMN location_address SET NOT NULL;
