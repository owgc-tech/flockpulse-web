import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse } from '@/src/lib/auth/middleware';
import { runTaskAutoAssign } from '@/src/features/tasks/autoAssign.service';

// Leader-tier-or-above, matching event-tasks-assignments's existing gating.
const requireLeader = requireRole('LEADER');

// POST /api/tasks/auto-assign — round-robin the given roster across every
// open slot (for the given task_id) on an upcoming event whose type is in
// event_type_ids. Replaces the old hardcoded prayer-leader/food-assignment
// routes (DIP-FP-180-adj-6) — task_id is now supplied by the client instead
// of being resolved server-side from one of two fixed names; individuals-vs-
// groups is enforced by runTaskAutoAssign reading the selected task's live
// individual_only flag. Unconditionally overwrites existing assignees — the
// confirm-before-run warning lives client-side, not here.
export async function POST(req: NextRequest) {
  return withAuth(req, requireLeader(async (_, ctx) => {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse('INVALID_BODY', 'Request body required', 400);

    const { task_id, roster, event_type_ids } = body;
    if (!task_id) return errorResponse('MISSING_FIELD', 'task_id is required', 400);
    if (!Array.isArray(roster)) return errorResponse('MISSING_FIELD', 'roster array required', 400);
    if (!Array.isArray(event_type_ids)) return errorResponse('MISSING_FIELD', 'event_type_ids array required', 400);

    try {
      const assignments = await runTaskAutoAssign(ctx.tenantId, task_id, roster, ctx.memberId, event_type_ids);
      return NextResponse.json({ data: assignments }, { status: 200 });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'NOT_FOUND') return errorResponse('NOT_FOUND', (err as Error).message, 404);
      if (code === 'VALIDATION_ERROR') return errorResponse('VALIDATION_ERROR', (err as Error).message, 422);
      throw err;
    }
  }));
}
