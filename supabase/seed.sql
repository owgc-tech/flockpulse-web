-- Seed Tenants
INSERT INTO tenants (id, name) VALUES
('00000000-0000-0000-0000-000000000001', 'Global Corp'),
('00000000-0000-0000-0000-000000000002', 'Delta Org')
ON CONFLICT DO NOTHING;

-- Seed default event types (one per tenant — mirrors migration 000016 Section 2,
-- which runs before seed.sql so would find empty tenants at db reset time)
INSERT INTO event_types (tenant_id, name, code) VALUES
('00000000-0000-0000-0000-000000000001', 'General', 'GENERAL'),
('00000000-0000-0000-0000-000000000002', 'General', 'GENERAL')
ON CONFLICT DO NOTHING;

-- Seed Members (Mock users)
-- gender/marital_status/birthdate added by migration 000020 as NOT NULL;
-- dummy values supplied here for development seed data only.
INSERT INTO members (tenant_id, user_id, email, role, first_name, last_name, gender, marital_status, birthdate) VALUES
('00000000-0000-0000-0000-000000000001', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'admin@global.com', 'ADMIN', 'Admin', 'User', 'MALE', 'SINGLE', '1990-01-01'),
('00000000-0000-0000-0000-000000000001', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', 'leader@global.com', 'LEADER', 'Leader', 'User', 'MALE', 'SINGLE', '1990-01-01'),
('00000000-0000-0000-0000-000000000001', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13', 'member@global.com', 'MEMBER', 'Member', 'User', 'MALE', 'SINGLE', '1990-01-01')
ON CONFLICT DO NOTHING;

-- Seed Groups
INSERT INTO groups (id, tenant_id, name) VALUES
('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000001', 'Engineering Team')
ON CONFLICT DO NOTHING;