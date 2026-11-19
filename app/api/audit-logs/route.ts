import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole } from '@/src/lib/auth/middleware';
import { getAuditLogs } from '@/src/features/audit/audit.service';

const requireAdmin = requireRole('ADMIN');

// GET /api/audit-logs?entity_type=&entity_id=&action=&actor_id=&date_from=&date_to=
//
// Admin-tier only (STORY-10.2) — SR_COORDINATOR/COORDINATOR/COMMUNITY_SERVANT
// already resolve to Admin-tier via the rank system (FP-113), no separate
// role check needed.
export async function GET(req: NextRequest) {
  return withAuth(req, requireAdmin(async (_, ctx) => {
    const entityType = req.nextUrl.searchParams.get('entity_type') ?? undefined;
    const entityId = req.nextUrl.searchParams.get('entity_id') ?? undefined;
    const action = req.nextUrl.searchParams.get('action') ?? undefined;
    const actorId = req.nextUrl.searchParams.get('actor_id') ?? undefined;
    const dateFrom = req.nextUrl.searchParams.get('date_from') ?? undefined;
    const dateTo = req.nextUrl.searchParams.get('date_to') ?? undefined;

    const data = await getAuditLogs(ctx.tenantId, { entityType, entityId, action, actorId, dateFrom, dateTo });
    return NextResponse.json({ data });
  }));
}
