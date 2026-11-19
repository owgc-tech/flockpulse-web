import { NextRequest, NextResponse } from 'next/server';
import { withAuth, errorResponse } from '@/src/lib/auth/middleware';
import { submitSelfReport } from '@/src/features/self-reports/self-report.service';

// POST /api/self-reports — Member submits post-event attendance self-report.
// Any authenticated member may call this; role is not restricted above MEMBER.
// tenant_id and member_id are resolved server-side from the JWT — never from the request body.
export async function POST(req: NextRequest) {
  return withAuth(req, async (_, ctx) => {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse('INVALID_BODY', 'Request body required', 400);

    const { event_id, self_report_status, reason, feedback, star_rating } = body;

    if (!event_id) return errorResponse('MISSING_FIELD', 'event_id required', 400);
    if (!self_report_status) return errorResponse('MISSING_FIELD', 'self_report_status required', 400);
    if (self_report_status !== 'SELF_REPORTED_YES' && self_report_status !== 'SELF_REPORTED_NO') {
      return errorResponse(
        'INVALID_VALUE',
        'self_report_status must be SELF_REPORTED_YES or SELF_REPORTED_NO',
        400
      );
    }

    try {
      const report = await submitSelfReport(ctx.tenantId, ctx.memberId, {
        eventId: event_id,
        selfReportStatus: self_report_status,
        reason,
        feedback,
        starRating: star_rating,
      });
      return NextResponse.json({ data: report }, { status: 201 });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'NOT_FOUND') return errorResponse('NOT_FOUND', (err as Error).message, 404);
      if (code === 'FORBIDDEN_SCOPE') return errorResponse('FORBIDDEN_SCOPE', (err as Error).message, 403);
      if (code === 'ATTENDANCE_NOT_OPEN') return errorResponse('ATTENDANCE_NOT_OPEN', (err as Error).message, 422);
      if (code === 'SELF_REPORT_NOT_OPEN') return errorResponse('SELF_REPORT_NOT_OPEN', (err as Error).message, 422);
      if (code === 'SELF_REPORT_ALREADY_SUBMITTED') return errorResponse('SELF_REPORT_ALREADY_SUBMITTED', (err as Error).message, 409);
      if (code === 'SELF_REPORT_REASON_REQUIRED') return errorResponse('SELF_REPORT_REASON_REQUIRED', (err as Error).message, 422);
      if (code === 'VALIDATION_ERROR') return errorResponse('VALIDATION_ERROR', (err as Error).message, 422);
      throw err;
    }
  });
}
