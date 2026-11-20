-- FP-255: one-time cleanup for members removed BEFORE the FP-255 migration.
-- Joseph runs this by hand in the Supabase SQL Editor, AFTER applying migration
-- 20261120000087, and only after Atlas has seen the section A counts.
-- It is NOT a migration. Run the sections ONE AT A TIME: A, then B, then C.
-- Counts only, grouped by community name: no member names, no ids.

-- ============================================================================
-- SECTION A. PREVIEW (read-only). Run it first and send Atlas the result.
--   demographics_still_set : removed members whose gender or marital status is still set
--   birthdate_still_set    : removed members whose birthdate is still set (even just a year)
--   dead_login_link        : removed members whose user_id points at a login that no longer exists
--   stray_login_exists     : removed members whose login STILL exists (left alone by B;
--                            pressing Remove again on them in the app finishes it)
-- ============================================================================
SELECT t.name AS community,
       count(*) FILTER (WHERE m.gender IS NOT NULL OR m.marital_status IS NOT NULL) AS demographics_still_set,
       count(*) FILTER (WHERE m.birthdate IS NOT NULL) AS birthdate_still_set,
       count(*) FILTER (WHERE m.user_id IS NOT NULL
                          AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = m.user_id)) AS dead_login_link,
       count(*) FILTER (WHERE m.user_id IS NOT NULL
                          AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = m.user_id)) AS stray_login_exists
FROM members m
JOIN tenants t ON t.id = m.tenant_id
WHERE m.deleted_at IS NOT NULL
GROUP BY t.name
ORDER BY t.name;

-- ============================================================================
-- SECTION B. CLEANUP (idempotent: a second run changes nothing).
-- Run after Atlas confirms the section A counts.
-- ============================================================================
BEGIN;

UPDATE members
SET gender = NULL, marital_status = NULL
WHERE deleted_at IS NOT NULL
  AND (gender IS NOT NULL OR marital_status IS NOT NULL);

UPDATE members
SET birthdate = NULL
WHERE deleted_at IS NOT NULL
  AND birthdate IS NOT NULL;

UPDATE members m
SET user_id = NULL
WHERE m.deleted_at IS NOT NULL
  AND m.user_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = m.user_id);

COMMIT;

-- ============================================================================
-- SECTION C. VERIFY. Run section A again: demographics_still_set, birthdate_still_set and
-- dead_login_link should now be 0 for every community. stray_login_exists may be
-- above 0; those people are finished by pressing Remove on them in the app.
-- ============================================================================
SELECT t.name AS community,
       count(*) FILTER (WHERE m.gender IS NOT NULL OR m.marital_status IS NOT NULL) AS demographics_still_set,
       count(*) FILTER (WHERE m.birthdate IS NOT NULL) AS birthdate_still_set,
       count(*) FILTER (WHERE m.user_id IS NOT NULL
                          AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = m.user_id)) AS dead_login_link,
       count(*) FILTER (WHERE m.user_id IS NOT NULL
                          AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = m.user_id)) AS stray_login_exists
FROM members m
JOIN tenants t ON t.id = m.tenant_id
WHERE m.deleted_at IS NOT NULL
GROUP BY t.name
ORDER BY t.name;
