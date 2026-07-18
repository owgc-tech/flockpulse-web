import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse } from '@/src/lib/auth/middleware';
import { getAttendancePercentage } from '@/src/features/reports/report.service';
import { listGroups } from '@/src/features/groups/service';
import { getTenantSettings } from '@/src/features/tenant/service';
import type { AttendanceGranularity } from '@/src/features/reports/report.repository';

const VALID_GRANULARITIES: AttendanceGranularity[] = ['MEMBER', 'GROUP', 'COMMUNITY'];

// GET /api/reports/attendance/percentage?date_from=&date_to=&granularity=MEMBER|GROUP|COMMUNITY&event_type_id=...
//
// FP-130: date-range attendance percentage at Member/Group/Community
// granularity (event type filter optional — omit for all types). Same RBAC
// shape as /api/reports/attendance for MEMBER/GROUP; COMMUNITY is rejected
// for Leader-tier callers inside report.service.ts (FORBIDDEN_ROLE).
export async function GET(req: NextRequest) {
  return withAuth(req, requireRole('LEADER')(async (_, ctx) => {
    const eventTypeIds = req.nextUrl.searchParams.getAll('event_type_id');
    const dateFrom = req.nextUrl.searchParams.get('date_from');
    const dateTo = req.nextUrl.searchParams.get('date_to');
    const granularity = req.nextUrl.searchParams.get('granularity') as AttendanceGranularity | null;

    if (!dateFrom || !dateTo) {
      return errorResponse('VALIDATION_ERROR', 'date_from and date_to are required', 400);
    }
    if (!granularity || !VALID_GRANULARITIES.includes(granularity)) {
      return errorResponse('VALIDATION_ERROR', 'granularity must be MEMBER, GROUP, or COMMUNITY', 400);
    }

    try {
      // GROUP granularity breaks the result down by every group in the
      // tenant, so the full group list is resolved here rather than
      // threaded through as a filter — the shared event-type checkbox and
      // date-range filters narrow which attendance rows count, not which
      // groups appear as rows.
      const groups = granularity === 'GROUP'
        ? ((await listGroups(ctx.tenantId)) ?? []).map((g) => ({ id: g.id as string, name: g.name as string }))
        : undefined;

      // FP-142: only fetched when actually needed, not on every request
      // regardless of granularity.
      const communityName = granularity === 'COMMUNITY'
        ? (await getTenantSettings(ctx.tenantId)).name
        : undefined;

      const data = await getAttendancePercentage(ctx.tenantId, ctx.memberId, ctx.role, {
        eventTypeIds: eventTypeIds.length > 0 ? eventTypeIds : undefined,
        dateFrom,
        dateTo,
        granularity,
        groups,
        communityName,
      });
      return NextResponse.json({ data });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code) return errorResponse(code, (err as Error).message, code === 'FORBIDDEN_ROLE' ? 403 : 400);
      throw err;
    }
  }));
}
