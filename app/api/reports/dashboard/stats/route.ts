import { NextRequest, NextResponse } from 'next/server';
import { withAuth, errorResponse } from '@/src/lib/auth/middleware';
import { getDashboardStats } from '@/src/features/reports/report.service';

// GET /api/reports/dashboard/stats?event_id=... — the mobile Dashboard
// tab's three stat cards (attendance, RSVP, rating + anonymized feedback)
// for a single event. Open to every authenticated role — getDashboardStats()
// itself validates the event is tenant-scoped and, for non-Admin-tier
// callers, that the caller is actually invited to it (event_attendees).
export async function GET(req: NextRequest) {
  return withAuth(req, async (_, ctx) => {
    const eventId = req.nextUrl.searchParams.get('event_id');
    if (!eventId) return errorResponse('MISSING_PARAM', 'event_id query param required', 400);

    try {
      const stats = await getDashboardStats(ctx.tenantId, ctx.memberId, ctx.role, eventId);
      return NextResponse.json({ data: stats });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'NOT_FOUND_IN_TENANT') {
        return errorResponse('NOT_FOUND_IN_TENANT', (err as Error).message, 404);
      }
      if (code === 'FORBIDDEN_SCOPE') {
        return errorResponse('FORBIDDEN_SCOPE', (err as Error).message, 403);
      }
      throw err;
    }
  });
}
