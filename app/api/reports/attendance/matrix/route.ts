import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse } from '@/src/lib/auth/middleware';
import { getAttendanceMatrixByEventType } from '@/src/features/reports/report.service';

// GET /api/reports/attendance/matrix?event_type_id=<id>&event_type_id=<id>...
//
// FP-129: per-member yearly Present/Absent/%Present matrix, filtered by one
// or multiple event types (repeat the event_type_id param; omit for all
// types). Same RBAC shape as /api/reports/attendance — LEADER-tier scoped
// to assigned members, ADMIN-tier unrestricted within tenant.
export async function GET(req: NextRequest) {
  return withAuth(req, requireRole('LEADER')(async (_, ctx) => {
    const eventTypeIds = req.nextUrl.searchParams.getAll('event_type_id');

    try {
      const data = await getAttendanceMatrixByEventType(ctx.tenantId, ctx.memberId, ctx.role, {
        eventTypeIds,
      });
      return NextResponse.json({ data });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code) return errorResponse(code, (err as Error).message, 400);
      throw err;
    }
  }));
}
