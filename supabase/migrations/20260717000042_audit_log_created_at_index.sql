-- DIP-FP-42: index for the Audit Logs page's date-range filter (STORY-10.2).
-- audit_logs already has (tenant_id, entity_type, entity_id) and
-- (tenant_id, actor_id); neither covers a tenant-scoped created_at range scan.

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(tenant_id, created_at);
