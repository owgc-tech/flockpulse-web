-- Seed Tenants
INSERT INTO tenants (id, name) VALUES
('00000000-0000-0000-0000-000000000001', 'Global Corp'),
('00000000-0000-0000-0000-000000000002', 'Delta Org')
ON CONFLICT DO NOTHING;

-- Seed Members (Mock users)
INSERT INTO members (tenant_id, user_id, email, role, first_name, last_name) VALUES
('00000000-0000-0000-0000-000000000001', gen_random_uuid(), 'admin@global.com', 'ADMIN', 'Admin', 'User'),
('00000000-0000-0000-0000-000000000001', gen_random_uuid(), 'leader@global.com', 'LEADER', 'Leader', 'User'),
('00000000-0000-0000-0000-000000000001', gen_random_uuid(), 'member@global.com', 'MEMBER', 'Member', 'User')
ON CONFLICT DO NOTHING;

-- Seed Groups
INSERT INTO groups (id, tenant_id, name) VALUES
('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000001', 'Engineering Team')
ON CONFLICT DO NOTHING;