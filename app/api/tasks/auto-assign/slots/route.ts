import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse } from '@/src/lib/auth/middleware';
import { getTaskAutoAssignData } from '@/src/features/tasks/autoAssign.service';

// Leader-tier-or-above, matching event-tasks-assignments's existing gating.
const requireLeader = requireRole('LEADER');

// GET /api/tasks/auto-assign/slots?task_id=X&event_type_ids=a,b,c — every
// open slot (for the given task) on an upcoming (DRAFT/SCHEDULED/ACTIVE)
// event whose type is in the given comma-separated list, for the
// auto-assign panel's slot list and roster-scoped summary table. Replaces
// the old hardcoded prayer-leader/food-assignment slots routes
// (DIP-FP-180-adj-6). task_id is required (MISSING_FIELD 400 if absent),
// consistent with how event_id/task_id are already required elsewhere in
// this codebase. A missing/empty event_type_ids param becomes [], which
// returns an empty slot list rather than an error — every event type starts
// unchecked on the panel, so this is the actual default state
// (DIP-FP-180-adj-4), not a failure mode.
export async function GET(req: NextRequest) {
  return withAuth(req, requireLeader(async (_, ctx) => {
    const taskId = req.nextUrl.searchParams.get('task_id');
    if (!taskId) return errorResponse('MISSING_FIELD', 'task_id is required', 400);

    const rawEventTypeIds = req.nextUrl.searchParams.get('event_type_ids');
    const eventTypeIds = rawEventTypeIds ? rawEventTypeIds.split(',').filter(Boolean) : [];

    try {
      const { slots } = await getTaskAutoAssignData(ctx.tenantId, taskId, eventTypeIds);
      return NextResponse.json({ data: slots }, { status: 200 });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'NOT_FOUND') return errorResponse('NOT_FOUND', (err as Error).message, 404);
      throw err;
    }
  }));
}
