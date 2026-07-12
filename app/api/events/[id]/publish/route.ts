import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse, isExactlyLeaderTier } from '@/src/lib/auth/middleware';
import { publishEvent } from '@/src/features/events/service';

// DIP-FP-114-web: Leader-tier may publish only drafts they created (ownership
// scoping below) — a natural extension of being able to create their own events.
const requireLeader = requireRole('LEADER');

export const POST = (req: NextRequest, { params }: { params: Promise<{ id: string }> }) =>
  withAuth(req, requireLeader(async (_, ctx) => {
    const { id } = await params;
    if (!id) return errorResponse('MISSING_PARAM', 'Event id required', 400);

    try {
      const event = await publishEvent(id, ctx.tenantId, isExactlyLeaderTier(ctx.role) ? ctx.memberId : undefined);
      return NextResponse.json({ data: event });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'NOT_FOUND') return errorResponse('NOT_FOUND', 'Event not found', 404);
      if (code === 'FORBIDDEN_SCOPE') return errorResponse('FORBIDDEN_SCOPE', (err as Error).message, 403);
      if (code === 'INVALID_TRANSITION') return errorResponse('INVALID_TRANSITION', (err as Error).message, 422);
      if (code === 'MISSING_FIELD') return errorResponse('MISSING_FIELD', (err as Error).message, 422);
      if (code === 'INVALID_DATETIME') return errorResponse('INVALID_DATETIME', (err as Error).message, 422);
      throw err;
    }
  }));
