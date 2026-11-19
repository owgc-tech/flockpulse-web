import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/src/lib/auth/middleware';
import { getDashboardEventTypes } from '@/src/features/reports/report.service';

// GET /api/reports/dashboard/event-types — mobile Dashboard tab's first
// selection step. Open to every authenticated role — visibility is enforced
// inside the service/repository layer (Admin-tier: every active event type
// tenant-wide; everyone else: only types with at least one event they're
// invited to), not via a route-level role gate.
export async function GET(req: NextRequest) {
  return withAuth(req, async (_, ctx) => {
    const eventTypes = await getDashboardEventTypes(ctx.tenantId, ctx.memberId, ctx.role);
    return NextResponse.json({ data: eventTypes });
  });
}
