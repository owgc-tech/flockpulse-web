-- FP-104: Community Banner — logo_url + tagline on tenants, Storage bucket for logos.
--
-- SECTION 1: Schema additions to tenants
-- ==============================================================
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS tagline TEXT;

-- SECTION 2: Storage bucket
-- ==============================================================
-- Public bucket so logo URLs are directly accessible without a signed token.
INSERT INTO storage.buckets (id, name, public)
VALUES ('tenant-logos', 'tenant-logos', true)
ON CONFLICT (id) DO NOTHING;

-- SECTION 3: Storage RLS — defense-in-depth
-- ==============================================================
-- Actual upload enforcement is in the Server Action (service-role client bypasses
-- RLS). These policies are defense-in-depth against direct API access.
--
-- storage.foldername() verified against installed version:
--   storage.foldername('tenant-uuid/logo') → ['tenant-uuid']
-- So [1] (1-indexed in Postgres) = first path segment = tenant ID.

-- Public read (logo URLs embedded in HTML need no auth token)
DROP POLICY IF EXISTS "Public read tenant logos" ON storage.objects;
CREATE POLICY "Public read tenant logos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'tenant-logos');

-- Admin-only write: caller must be the admin of the tenant whose folder it is
DROP POLICY IF EXISTS "Admin write tenant logos" ON storage.objects;
CREATE POLICY "Admin write tenant logos"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'tenant-logos'
    AND (storage.foldername(name))[1] = get_tenant_id()::text
    AND caller_is_admin()
  );

DROP POLICY IF EXISTS "Admin update tenant logos" ON storage.objects;
CREATE POLICY "Admin update tenant logos"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'tenant-logos'
    AND (storage.foldername(name))[1] = get_tenant_id()::text
    AND caller_is_admin()
  );
