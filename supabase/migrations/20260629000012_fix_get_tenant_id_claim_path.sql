-- FP-50: get_tenant_id() read a top-level 'tenant_id' JWT claim; Supabase Auth actually
-- nests custom claims under app_metadata.tenant_id. Every RLS policy in this schema calls
-- this function, so every one of them has evaluated tenant_id = NULL for every real authenticated
-- user since the schema's first migration — denying everyone, unconditionally, on every table.
--
-- Two prior wrong definitions existed:
--   20260629000000 (original):  current_setting('request.jwt.claims', true)::json->>'tenant_id'
--   20260629000002 (hardening): auth.jwt() ->> 'tenant_id'   -- currently active, same mistake
--
-- This fix corrects the JSON path to read the nested app_metadata claim. No change to the
-- TypeScript layer (src/lib/auth/middleware.ts) — it already reads app_metadata.tenant_id
-- correctly from the parsed Supabase user object; only this SQL-side function was wrong.

CREATE OR REPLACE FUNCTION public.get_tenant_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
  SELECT (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::UUID;
$$;
