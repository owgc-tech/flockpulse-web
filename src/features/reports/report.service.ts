import { isExactlyLeaderTier, type Role } from '@/src/lib/auth/middleware';
import { getAssignedMemberIds } from '@/src/features/confirmations/confirmation.repository';
import {
  getRsvpReport as getRsvpReportRepo,
  getAttendanceReport as getAttendanceReportRepo,
  type RsvpReportFilters,
  type AttendanceReportFilters,
  type RsvpReportRow,
  type AttendanceReportRow,
} from './report.repository';

// ADMIN-tier sees all tenant members; LEADER-tier sees only assigned members.
// Rank-based (isExactlyLeaderTier), not a literal `role === 'LEADER'` — see
// 20260715000038_expand_role_model.sql's note on PASTORAL_LEADER falling
// through to the unscoped branch if a literal comparison were used here.
async function resolveLeaderScope(tenantId: string, callerId: string, callerRole: Role): Promise<string[] | null> {
  if (isExactlyLeaderTier(callerRole)) {
    return getAssignedMemberIds(tenantId, callerId);
  }
  return null;
}

export async function getRsvpReport(
  tenantId: string,
  callerId: string,
  callerRole: Role,
  filters: Omit<RsvpReportFilters, 'leaderScopedMemberIds'>
): Promise<RsvpReportRow[]> {
  const leaderScopedMemberIds = await resolveLeaderScope(tenantId, callerId, callerRole);
  return getRsvpReportRepo(tenantId, { ...filters, leaderScopedMemberIds });
}

export async function getAttendanceReport(
  tenantId: string,
  callerId: string,
  callerRole: Role,
  filters: Omit<AttendanceReportFilters, 'leaderScopedMemberIds'>
): Promise<AttendanceReportRow[]> {
  const leaderScopedMemberIds = await resolveLeaderScope(tenantId, callerId, callerRole);
  return getAttendanceReportRepo(tenantId, { ...filters, leaderScopedMemberIds });
}
