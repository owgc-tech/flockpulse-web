import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse, isExactlyLeaderTier } from '@/src/lib/auth/middleware';
import { createTaskAssignment, listTaskAssignmentsForEventWithRefusals } from '@/src/features/tasks/eventTaskAssignment.service';
import { assertCallerCanOpenEvent } from '@/src/features/events/service';

// Leader-tier-or-above, matching how the old prayer_leader_member_id/food_assignment
// event columns this table replaced (FP-161-3, columns dropped in FP-161-4) were
// gated: requireRole('LEADER') in app/api/events/route.ts.
const requireLeader = requireRole('LEADER');

// GET /api/event-tasks-assignments?event_id=X — list assignments for an event.
// FP-239: any authenticated tenant member, but only for an event the caller may open (the shared
// rule: Admin tier, owner, invited, or holding a task on it) — 403 FORBIDDEN_SCOPE otherwise,
// 404 NOT_FOUND for an unknown or other-community event.
export async function GET(req: NextRequest) {
  return withAuth(req, async (_, ctx) => {
    const eventId = req.nextUrl.searchParams.get('event_id');
    if (!eventId) return errorResponse('MISSING_FIELD', 'event_id query param required', 400);

    try {
      await assertCallerCanOpenEvent(ctx.tenantId, ctx.memberId, ctx.role, eventId);
      // FP-222-adj-1: each row also carries refused_by (who refused) — filled only for the
      // event's owner and Admin-tier callers, an empty array for everyone else.
      const assignments = await listTaskAssignmentsForEventWithRefusals(eventId, ctx.tenantId, { memberId: ctx.memberId, role: ctx.role });
      return NextResponse.json({ data: assignments }, { status: 200 });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'NOT_FOUND') return errorResponse('NOT_FOUND', 'Event not found', 404);
      if (code === 'FORBIDDEN_SCOPE') return errorResponse('FORBIDDEN_SCOPE', (err as Error).message, 403);
      throw err;
    }
  });
}

// POST /api/event-tasks-assignments — create an assignment (Leader-tier-or-above).
// FP-239: a Leader may do this only on an event they own (403 FORBIDDEN_SCOPE otherwise).
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
      }, ctx.memberId, isExactlyLeaderTier(ctx.role) ? ctx.memberId : undefined); // FP-222: actor, so the editor never sees their own change as modified; FP-239: owner scope for a Leader
      return NextResponse.json({ data: assignment }, { status: 201 });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'FORBIDDEN_SCOPE') return errorResponse('FORBIDDEN_SCOPE', (err as Error).message, 403);
      if (code === 'VALIDATION_ERROR') return errorResponse('VALIDATION_ERROR', (err as Error).message, 422);
      // DIP-FP-190-web: memberName is attached structurally by
      // mapUnavailabilityError() — surfaced alongside the message so the
      // caller doesn't need to re-parse it out of free text.
      if (code === 'MEMBER_UNAVAILABLE') {
        return NextResponse.json(
          { error: { code, message: (err as Error).message, memberName: (err as { memberName?: string }).memberName } },
          { status: 422 }
        );
      }
      throw err;
    }
  }));
}
