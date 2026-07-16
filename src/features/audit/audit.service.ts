import { getAuditLogs as getAuditLogsRepo, type AuditLogFilters, type AuditLogRow } from './audit.repository';

// Thin pass-through — unlike Reports (Leader-vs-Admin scoping variance), this
// feature is Admin-tier-or-nothing, already enforced by requireRole('ADMIN')
// at the route level. No caller-scoping logic belongs here.
export async function getAuditLogs(tenantId: string, filters: AuditLogFilters): Promise<AuditLogRow[]> {
  return getAuditLogsRepo(tenantId, filters);
}
