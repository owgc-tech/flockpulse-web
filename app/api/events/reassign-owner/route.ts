import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse } from '@/src/lib/auth/middleware';
import { reassignEventOwner } from '@/src/features/events/service';

const requireAdmin = requireRole('ADMIN');

// POST /api/events/reassign-owner — Admin only. body: { eventId, newOwnerMemberId }.
// actorMemberId derived server-side from ctx.memberId, never client-supplied, matching the
// established pattern (e.g. groups/reassign-owner).
export const POST = (req: NextRequest) =>
  withAuth(req, requireAdmin(async (req, ctx) => {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse('INVALID_BODY', 'Request body required', 400);

    const { eventId, newOwnerMemberId } = body;
    if (!eventId || !newOwnerMemberId) {
      return errorResponse('MISSING_FIELD', 'eventId and newOwnerMemberId required', 400);
    }

    try {
      const result = await reassignEventOwner(eventId, ctx.tenantId, newOwnerMemberId, ctx.memberId);
      return NextResponse.json({ data: result });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'NOT_FOUND_IN_TENANT') return errorResponse('NOT_FOUND_IN_TENANT', 'Event not found for this tenant', 404);
      if (code === 'VALIDATION_ERROR') return errorResponse('VALIDATION_ERROR', (err as Error).message, 422);
      throw err;
    }
  }));
