-- DIP-FP-114-web: events had zero creator/owner tracking. Leader-tier can now
-- create/edit/cancel events, but only their own — this column is what "own"
-- means. No backfill: events created before this migration have no creator on
-- record, so no Leader-tier account can edit/cancel them (Admin-tier still can,
-- unchanged) — a natural consequence of data that predates ownership tracking,
-- not something to retroactively invent.

ALTER TABLE events
    ADD COLUMN IF NOT EXISTS created_by_member_id UUID REFERENCES members(id);
