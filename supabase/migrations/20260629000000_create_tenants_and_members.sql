-- 1. Create Tenants Table
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Create Members Table
CREATE TABLE IF NOT EXISTS members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID UNIQUE NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('ADMIN', 'LEADER', 'MEMBER')),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Create a Performance Index for the Foreign Key
-- This resolves the "Unindexed foreign keys" warning in the performance advisor
CREATE INDEX IF NOT EXISTS idx_members_tenant_id ON members(tenant_id);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE members ENABLE ROW LEVEL SECURITY;

-- 5. Create Optimized Helper Function to Cache JWT Tenant Context
CREATE OR REPLACE FUNCTION get_tenant_id()
RETURNS UUID AS $$
    SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'tenant_id', '')::UUID;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- 6. Create Clean, Non-Overlapping Tenant-Isolated RLS Policies
CREATE POLICY tenant_isolation_policy ON tenants
    FOR ALL
    USING (id = get_tenant_id());

CREATE POLICY member_isolation_policy ON members
    FOR ALL
    USING (tenant_id = get_tenant_id())
    WITH CHECK (tenant_id = get_tenant_id());