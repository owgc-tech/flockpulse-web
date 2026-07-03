-- FP-53: migration 000015 (courses/modules/talks) erroneously granted anon SELECT
-- access — copy-paste error, deviates from migration 000011's deliberate design
-- ("no endpoint should be reachable without a JWT"). The same mistake was caught
-- and fixed before merge in migration 000016 (FP-45); this is the corrective fix
-- for the version that already reached dev. Do not amend 000015 — new migration only.

REVOKE SELECT ON courses FROM anon;
REVOKE SELECT ON modules FROM anon;
REVOKE SELECT ON talks   FROM anon;
