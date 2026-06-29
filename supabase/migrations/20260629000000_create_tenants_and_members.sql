-- 1. Create tenants table
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create members table
CREATE TABLE IF NOT EXISTS members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL, -- references auth.users(id)
    email TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('Member', 'Leader', 'Admin')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Enable RLS
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE members ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies
-- Helper function to check role hierarchy
CREATE OR REPLACE FUNCTION check_role_access(required_role TEXT) RETURNS BOOLEAN AS $$
DECLARE
    user_role TEXT;
    roles_hierarchy TEXT[] := ARRAY['Member', 'Leader', 'Admin'];
BEGIN
    user_role := (auth.jwt() ->> 'role');
    RETURN array_position(roles_hierarchy, user_role) >= array_position(roles_hierarchy, required_role);
END;
$$ LANGUAGE plpgsql;

-- Policy: Tenants (Only accessible by members of the tenant)
CREATE POLICY "Tenants are visible to members of that tenant" ON tenants
    FOR SELECT USING (id = (auth.jwt() ->> 'tenant_id')::UUID);

-- Policy: Members (Only accessible by members of the same tenant)
CREATE POLICY "Members are visible to members of the same tenant" ON members
    FOR SELECT USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

-- Policy: Members (Restrict modification based on role)
CREATE POLICY "Admins can insert/update members" ON members
    FOR ALL USING (
        tenant_id = (auth.jwt() ->> 'tenant_id')::UUID
        AND check_role_access('Admin')
    );
