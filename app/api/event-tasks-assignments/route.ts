import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse } from '@/src/lib/auth/middleware';
import { createTaskAssignment, listTaskAssignmentsForEvent } from '@/src/features/tasks/eventTaskAssignment.service';

// Leader-tier-or-above, matching how the old prayer_leader_member_id/food_assignment
// event columns this table replaced (FP-161-3, columns dropped in FP-161-4) were
// gated: requireRole('LEADER') in app/api/events/route.ts.
const requireLeader = requireRole('LEADER');

// GET /api/event-tasks-assignments?event_id=X — list assignments for an event
// (any authenticated tenant member, matching GET /api/events)
export async function GET(req: NextRequest) {
  return withAuth(req, async (_, ctx) => {
    const eventId = req.nextUrl.searchParams.get('event_id');
    if (!eventId) return errorResponse('MISSING_FIELD', 'event_id query param required', 400);

    const assignments = await listTaskAssignmentsForEvent(eventId, ctx.tenantId);
    return NextResponse.json({ data: assignments }, { status: 200 });
  });
}

// POST /api/event-tasks-assignments — create an assignment (Leader-tier-or-above)
export async function POST(req: NextRequest) {
  return withAuth(req, requireLeader(async (_, ctx) => {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse('INVALID_BODY', 'Request body required', 400);

    const { event_id, task_id, assignee } = body;
    if (!event_id) return errorResponse('MISSING_FIELD', 'event_id required', 400);
    if (!task_id) return errorResponse('MISSING_FIELD', 'task_id required', 400);

    try {
      const assignment = await createTaskAssignment(ctx.tenantId, {
        eventId: event_id,
        taskId: task_id,
        assignee: assignee ?? null,
      });
      return NextResponse.json({ data: assignment }, { status: 201 });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'VALIDATION_ERROR') return errorResponse('VALIDATION_ERROR', (err as Error).message, 422);
      throw err;
    }
  }));
}
