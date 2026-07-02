import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse } from '@/src/lib/auth/middleware';
import { submitAttendanceOverride } from '@/src/features/attendance-overrides/attendance-override.service';

// POST /api/attendance/override — FP-25: Admin override of official attendance.
// Admin only — no leader path for this endpoint.
export async function POST(req: NextRequest) {
  return withAuth(req, requireRole('ADMIN')(async (_, ctx) => {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse('INVALID_BODY', 'Request body required', 400);

    const { event_id, member_id, attendance_status, reason } = body;

    if (!event_id) return errorResponse('MISSING_FIELD', 'event_id required', 400);
    if (!member_id) return errorResponse('MISSING_FIELD', 'member_id required', 400);
    if (!attendance_status) return errorResponse('MISSING_FIELD', 'attendance_status required', 400);
    if (!reason) return errorResponse('MISSING_FIELD', 'reason required', 400);

    if (attendance_status !== 'ATTENDED' && attendance_status !== 'DID_NOT_ATTEND') {
      return errorResponse('INVALID_TARGET', 'attendance_status must be ATTENDED or DID_NOT_ATTEND', 400);
    }

    try {
      const result = await submitAttendanceOverride(ctx.tenantId, ctx.memberId, {
        eventId: event_id,
        memberId: member_id,
        attendanceStatus: attendance_status,
        reason,
      });
      return NextResponse.json({ data: result }, { status: 200 });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'NOT_FOUND') return errorResponse('NOT_FOUND', (err as Error).message, 404);
      if (code === 'FORBIDDEN_SCOPE') return errorResponse('FORBIDDEN_SCOPE', (err as Error).message, 403);
      if (code === 'ATTENDANCE_NOT_OPEN') return errorResponse('ATTENDANCE_NOT_OPEN', (err as Error).message, 422);
      throw err;
    }
  }));
}
