import { isExactlyLeaderTier, type Role } from '@/src/lib/auth/middleware';
import { getAssignedMemberIds } from '@/src/features/confirmations/confirmation.repository';
import {
  getRsvpReport as getRsvpReportRepo,
  getRsvpReportSummary as getRsvpReportSummaryRepo,
  getAttendanceReport as getAttendanceReportRepo,
  getAttendanceMatrixByEventType as getAttendanceMatrixByEventTypeRepo,
  getAttendancePercentage as getAttendancePercentageRepo,
  type RsvpReportFilters,
  type AttendanceReportFilters,
  type AttendanceMatrixFilters,
  type AttendancePercentageFilters,
  type RsvpReportRow,
  type RsvpReportSummaryRow,
  type AttendanceReportRow,
  type AttendanceMatrixResult,
  type AttendancePercentageRow,
} from './report.repository';

function serviceError(code: string, message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

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

export async function getRsvpReportSummary(
  tenantId: string,
  callerId: string,
  callerRole: Role,
  filters: Omit<RsvpReportFilters, 'leaderScopedMemberIds'>
): Promise<RsvpReportSummaryRow[]> {
  const leaderScopedMemberIds = await resolveLeaderScope(tenantId, callerId, callerRole);
  return getRsvpReportSummaryRepo(tenantId, { ...filters, leaderScopedMemberIds });
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

// FP-129: same resolveLeaderScope pattern as every other report function —
// a Leader-tier caller's matrix is naturally narrowed to their assigned
// members, no new RBAC mechanism needed.
export async function getAttendanceMatrixByEventType(
  tenantId: string,
  callerId: string,
  callerRole: Role,
  filters: Omit<AttendanceMatrixFilters, 'leaderScopedMemberIds'>
): Promise<AttendanceMatrixResult> {
  const leaderScopedMemberIds = await resolveLeaderScope(tenantId, callerId, callerRole);
  return getAttendanceMatrixByEventTypeRepo(tenantId, { ...filters, leaderScopedMemberIds });
}

// FP-130: MEMBER/GROUP reuse resolveLeaderScope exactly like every other
// report function. COMMUNITY is the one new RBAC branch this DIP needs —
// per FP-130's explicit AC, blocked outright for Leader-tier (a
// leader-scoped "community" number would be misleading), since every other
// report treats Leader-tier as "scoped", never "denied".
export async function getAttendancePercentage(
  tenantId: string,
  callerId: string,
  callerRole: Role,
  filters: Omit<AttendancePercentageFilters, 'leaderScopedMemberIds'>
): Promise<AttendancePercentageRow[]> {
  if (filters.granularity === 'COMMUNITY' && isExactlyLeaderTier(callerRole)) {
    throw serviceError('FORBIDDEN_ROLE', 'COMMUNITY granularity requires ADMIN-tier or higher');
  }

  const leaderScopedMemberIds = await resolveLeaderScope(tenantId, callerId, callerRole);
  return getAttendancePercentageRepo(tenantId, { ...filters, leaderScopedMemberIds });
}
