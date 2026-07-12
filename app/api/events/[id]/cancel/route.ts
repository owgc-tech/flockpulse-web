import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse, isExactlyLeaderTier } from '@/src/lib/auth/middleware';
import { cancelEvent } from '@/src/features/events/service';

// DIP-FP-114-web: irreversible, but no longer Admin-only — Leader-tier may cancel
// only events they created (enforced below via ownership scoping).
const requireLeader = requireRole('LEADER');

// POST /api/events/:id/cancel — Admin-tier unrestricted; Leader-tier scoped to
// events they created. actorMemberId is derived server-side from ctx.memberId,
// never client-supplied (same pattern as POST /api/events).
export const POST = (req: NextRequest, { params }: { params: Promise<{ id: string }> }) =>
  withAuth(req, requireLeader(async (_, ctx) => {
    const { id } = await params;
    if (!id) return errorResponse('MISSING_PARAM', 'Event id required', 400);

    try {
      const event = await cancelEvent(id, ctx.tenantId, ctx.memberId, isExactlyLeaderTier(ctx.role) ? ctx.memberId : undefined);
      return NextResponse.json({ data: event });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'NOT_FOUND') return errorResponse('NOT_FOUND', 'Event not found', 404);
      if (code === 'FORBIDDEN_SCOPE') return errorResponse('FORBIDDEN_SCOPE', (err as Error).message, 403);
      if (code === 'INVALID_STATE_TRANSITION') return errorResponse('INVALID_STATE_TRANSITION', (err as Error).message, 422);
      throw err;
    }
  }));
