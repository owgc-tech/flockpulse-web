-- FP-228: read-only privilege audit for the public schema.
--
-- Returns rows ONLY on violations — zero rows means the database is API-only:
--   1. anon or authenticated holds ANY privilege on a table/view/sequence in public
--   2. anon or authenticated can EXECUTE a non-trigger function in public, other
--      than the two allow-listed registration functions
--   3. a table in public does not have row level security enabled
--
-- Functions that belong to an extension (e.g. btree_gist's operator-class support
-- functions, owned by supabase_admin) are not managed by our migrations and are
-- excluded from check 2.
--
-- Run:  psql "$DATABASE_URL" -f scripts/security/check-db-privileges.sql
--       (local: docker exec -i supabase_db_flockpulse-web psql -U postgres -d postgres < scripts/security/check-db-privileges.sql)

SELECT 'TABLE_PRIVILEGE' AS violation,
       r.rolname        AS role,
       c.relname        AS object,
       p.priv           AS detail
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rolname)
CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(priv)
WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND has_table_privilege(r.rolname, c.oid, p.priv)

UNION ALL

SELECT 'SEQUENCE_PRIVILEGE', r.rolname, c.relname, p.priv
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rolname)
CROSS JOIN (VALUES ('USAGE'), ('SELECT'), ('UPDATE')) p(priv)
WHERE c.relkind = 'S'
  AND has_sequence_privilege(r.rolname, c.oid, p.priv)

UNION ALL

SELECT 'FUNCTION_EXECUTE', r.rolname, p.oid::regprocedure::text, 'EXECUTE'
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rolname)
WHERE p.prorettype <> 'trigger'::regtype
  AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  AND has_function_privilege(r.rolname, p.oid, 'EXECUTE')
  AND NOT (r.rolname = 'authenticated'
           AND p.proname IN ('complete_registration', 'create_tenant_and_founding_admin'))

UNION ALL

SELECT 'RLS_DISABLED', '-', c.relname, 'row level security is not enabled'
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
WHERE c.relkind IN ('r', 'p') AND NOT c.relrowsecurity

ORDER BY 1, 2, 3, 4;
