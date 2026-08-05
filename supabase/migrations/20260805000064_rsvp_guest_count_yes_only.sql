-- DIP-FP-189-web-adj-1: guest_count becomes Yes-only, reversing the original
-- FP-189-web DIP's Yes/Tentative allowance. Confirmed live before writing this:
-- no TENTATIVE row currently has a non-null guest_count on fpdb-dev, so the
-- cleanup UPDATE below is a no-op today — it stays in the migration regardless,
-- since ALTER TABLE ... ADD CONSTRAINT would reject the tightened CHECK on any
-- environment where a conflicting row does exist, and this must be safe to run
-- anywhere, not just against today's known-clean data.

-- ==============================================================
-- SECTION 1: data cleanup — must run before the constraint tightens, or the
-- ADD CONSTRAINT below fails against any existing violating row.
-- ==============================================================

UPDATE rsvps SET guest_count = NULL WHERE rsvp_status = 'TENTATIVE' AND guest_count IS NOT NULL;


-- ==============================================================
-- SECTION 2: tighten rsvps_guest_count_status_check to YES-only.
-- ==============================================================

ALTER TABLE rsvps DROP CONSTRAINT IF EXISTS rsvps_guest_count_status_check;
ALTER TABLE rsvps
    ADD CONSTRAINT rsvps_guest_count_status_check
    CHECK (guest_count IS NULL OR (rsvp_status = 'YES' AND guest_count >= 0));
