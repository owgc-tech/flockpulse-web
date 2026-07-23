import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse } from '@/src/lib/auth/middleware';
import { runPrayerLeaderAutoAssign } from '@/src/features/tasks/autoAssign.service';

// Leader-tier-or-above, matching event-tasks-assignments's existing gating.
const requireLeader = requireRole('LEADER');

// POST /api/tasks/auto-assign/prayer-leader — round-robin the given roster
// (individuals only) across every open Prayer Leader slot on upcoming events.
// Unconditionally overwrites existing assignees — the confirm-before-run
// warning lives client-side, not here.
export async function POST(req: NextRequest) {
  return withAuth(req, requireLeader(async (_, ctx) => {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse('INVALID_BODY', 'Request body required', 400);

    const { roster } = body;
    if (!Array.isArray(roster)) return errorResponse('MISSING_FIELD', 'roster array required', 400);

    try {
      const assignments = await runPrayerLeaderAutoAssign(ctx.tenantId, roster, ctx.memberId);
      return NextResponse.json({ data: assignments }, { status: 200 });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'NOT_FOUND') return errorResponse('NOT_FOUND', (err as Error).message, 404);
      if (code === 'VALIDATION_ERROR') return errorResponse('VALIDATION_ERROR', (err as Error).message, 422);
      throw err;
    }
  }));
}
