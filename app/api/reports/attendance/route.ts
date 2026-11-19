import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse } from '@/src/lib/auth/middleware';
import { getAttendanceReport } from '@/src/features/reports/report.service';

// GET /api/reports/attendance?event_id=&group_id=&member_id=&date_from=&date_to=
//
// RBAC (mirrors Confirmations' access level, per STORY-9.2):
//   LEADER-tier — scoped to assigned members only
//   ADMIN-tier  — unrestricted within tenant
export async function GET(req: NextRequest) {
  return withAuth(req, requireRole('LEADER')(async (_, ctx) => {
    const eventId = req.nextUrl.searchParams.get('event_id') ?? undefined;
    const groupId = req.nextUrl.searchParams.get('group_id') ?? undefined;
    const memberId = req.nextUrl.searchParams.get('member_id') ?? undefined;
    const dateFrom = req.nextUrl.searchParams.get('date_from') ?? undefined;
    const dateTo = req.nextUrl.searchParams.get('date_to') ?? undefined;

    try {
      const data = await getAttendanceReport(ctx.tenantId, ctx.memberId, ctx.role, {
        eventId, groupId, memberId, dateFrom, dateTo,
      });
      return NextResponse.json({ data });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code) return errorResponse(code, (err as Error).message, 400);
      throw err;
    }
  }));
}
