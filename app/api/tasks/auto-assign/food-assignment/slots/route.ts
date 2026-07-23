import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse } from '@/src/lib/auth/middleware';
import { getFoodAssignmentAutoAssignData } from '@/src/features/tasks/autoAssign.service';

// Leader-tier-or-above, matching event-tasks-assignments's existing gating.
const requireLeader = requireRole('LEADER');

// GET /api/tasks/auto-assign/food-assignment/slots — every open Food
// Assignment slot on an upcoming (SCHEDULED/ACTIVE) event, for the
// auto-assign panel's slot list and roster-scoped summary table.
export async function GET(req: NextRequest) {
  return withAuth(req, requireLeader(async (_, ctx) => {
    try {
      const { slots } = await getFoodAssignmentAutoAssignData(ctx.tenantId);
      return NextResponse.json({ data: slots }, { status: 200 });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'NOT_FOUND') return errorResponse('NOT_FOUND', (err as Error).message, 404);
      throw err;
    }
  }));
}
