import { NextRequest, NextResponse } from 'next/server';
import { withAuth, errorResponse } from '@/src/lib/auth/middleware';
import { getDashboardEventsForType } from '@/src/features/reports/report.service';

// GET /api/reports/dashboard/events?event_type_id=... — mobile Dashboard
// tab's second selection step, once an event type is picked. Current
// calendar year, already-started events only, most recent first. Open to
// every authenticated role — visibility enforced inside the service/
// repository layer, same as event-types/route.ts.
export async function GET(req: NextRequest) {
  return withAuth(req, async (_, ctx) => {
    const eventTypeId = req.nextUrl.searchParams.get('event_type_id');
    if (!eventTypeId) return errorResponse('MISSING_PARAM', 'event_type_id query param required', 400);

    const events = await getDashboardEventsForType(ctx.tenantId, ctx.memberId, ctx.role, eventTypeId);
    return NextResponse.json({ data: events });
  });
}
