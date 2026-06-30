-- 1. Alter members table
ALTER TABLE members
ADD COLUMN first_name TEXT,
ADD COLUMN last_name TEXT,
ADD COLUMN deleted_at TIMESTAMPTZ DEFAULT NULL;

-- 2. Enforce NOT NULL after adding columns (assuming empty table, otherwise set defaults)
ALTER TABLE members ALTER COLUMN first_name SET NOT NULL;
ALTER TABLE members ALTER COLUMN last_name SET NOT NULL;

-- 3. Unique Active Email Constraint
CREATE UNIQUE INDEX idx_members_unique_active_email_per_tenant
ON members(tenant_id, email)
WHERE (deleted_at IS NULL);

-- 4. Create Groups table
CREATE TABLE IF NOT EXISTS groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;

-- 5. Create Assignments table
CREATE TABLE IF NOT EXISTS assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    assignment_type TEXT NOT NULL CHECK (assignment_type IN ('GROUP', 'LEADER')),
    target_id UUID NOT NULL, -- references group_id or member_id
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (member_id, target_id)
);
ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;

-- 6. Update RLS policies
DROP POLICY IF EXISTS "Members are visible to members of the same tenant" ON members;
CREATE POLICY "Members are visible to members of the same tenant" ON members
    FOR SELECT USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID AND deleted_at IS NULL);

-- RLS: Groups
CREATE POLICY "Groups are visible to members of the same tenant" ON groups
    FOR SELECT USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

-- RLS: Assignments
CREATE POLICY "Assignments are visible to members of the same tenant" ON assignments
    FOR SELECT USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);
