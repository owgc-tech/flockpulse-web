-- FP-228: privilege snapshot -> rollback script generator (read-only).
-- Prints the GRANT statements that recreate the CURRENT anon/authenticated
-- privileges on tables, sequences and non-trigger, non-extension functions in
-- public. Run it against a database BEFORE applying 20261004000075 and keep the
-- output: it is the rollback for that database.
--
--   psql "$DATABASE_URL" -At -f scripts/security/snapshot-privileges.sql > rollback.sql

SELECT format('GRANT %s ON TABLE public.%I TO %I;', p.priv, c.relname, r.rolname)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rolname)
CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(priv)
WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND has_table_privilege(r.rolname, c.oid, p.priv)
UNION ALL
SELECT format('GRANT %s ON SEQUENCE public.%I TO %I;', p.priv, c.relname, r.rolname)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rolname)
CROSS JOIN (VALUES ('USAGE'), ('SELECT'), ('UPDATE')) p(priv)
WHERE c.relkind = 'S'
  AND has_sequence_privilege(r.rolname, c.oid, p.priv)
UNION ALL
SELECT format('GRANT EXECUTE ON FUNCTION %s TO %I;', p.oid::regprocedure, r.rolname)
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rolname)
WHERE p.prorettype <> 'trigger'::regtype
  AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  AND has_function_privilege(r.rolname, p.oid, 'EXECUTE')
ORDER BY 1;
