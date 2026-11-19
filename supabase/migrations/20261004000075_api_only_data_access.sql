-- FP-228-web: API-only data access.
--
-- The database used to be directly reachable by anonymous and logged-in
-- callers over PostgREST (anon/authenticated held table privileges and EXECUTE
-- on every function; RLS checks tenant only, not role). From now on every read
-- and write goes through the Next.js API using the service role, where the role
-- checks live:
--   * anon: no table, sequence or function access at all.
--   * authenticated: no table privileges (not even SELECT), no sequence
--     privileges, and EXECUTE on exactly two functions — the registration
--     functions, which the server calls with the user's own token.
--   * service_role: everything, unchanged.
--
-- This migration also records the stop-gap that was applied to the live database
-- by hand on 2026-10-04, so the repo matches the database. It deliberately does
-- NOT contain that stop-gap's trailing "GRANT EXECUTE ON ALL FUNCTIONS ... TO
-- authenticated", which wrongly re-opened server-only functions; who keeps
-- EXECUTE is decided in section C below.
--
-- Fully idempotent: every statement is a REVOKE/GRANT/ALTER DEFAULT PRIVILEGES
-- that is a no-op when already applied. Existing RLS policies are NOT dropped —
-- they stay as a second layer. USAGE on schema public is kept.
--
-- Re-check any time with scripts/security/check-db-privileges.sql (returns rows
-- only on violations) and scripts/security/probe-direct-access.mjs.


-- ==============================================================
-- SECTION A: re-state the stop-gap (anon locked out; authenticated loses writes)
-- ==============================================================

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
    ON ALL TABLES IN SCHEMA public FROM authenticated;

-- Matching default privileges, so objects created later by postgres in public
-- do not silently re-open anything.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;


-- ==============================================================
-- SECTION B: authenticated loses SELECT too. Keep USAGE on schema public.
-- (The two user-scoped reads that remained — tenants on the invitations page and
-- role_catalog on the registration form — were moved server-side in this change.)
-- ==============================================================

REVOKE SELECT ON ALL TABLES IN SCHEMA public FROM authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;


-- ==============================================================
-- SECTION C: functions. For every non-trigger function in public (derived from
-- pg_proc, never hand-typed), revoke EXECUTE from PUBLIC/anon/authenticated and
-- grant it to service_role; then grant back to authenticated ONLY the two
-- registration functions. Both derive tenant, role and identity from auth.uid()
-- and the invitation row (audited in FP-228), and are called with the user's own
-- token by registrantClient / founderClient, so they must stay callable.
--
-- Trigger functions are left alone: they cannot be called directly and EXECUTE
-- is not checked when a trigger fires. Functions that belong to an extension
-- (e.g. btree_gist's, owned by supabase_admin) are not ours to alter and are
-- skipped; they are internal operator-class support functions.
-- ==============================================================

DO $$
DECLARE
  f RECORD;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.prorettype <> 'trigger'::regtype
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e'
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);

    IF f.proname IN ('complete_registration', 'create_tenant_and_founding_admin') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
    END IF;
  END LOOP;
END
$$;


-- ==============================================================
-- SECTION D: defaults for the future. New tables, sequences and functions
-- created by postgres are not accessible to PUBLIC, anon or authenticated;
-- service_role keeps access. (PUBLIC's implicit EXECUTE on new functions is a
-- role-wide default, not per-schema, so it can only be revoked without
-- IN SCHEMA.)
-- ==============================================================

ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES    TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;
