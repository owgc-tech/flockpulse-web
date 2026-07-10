import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse } from '@/src/lib/auth/middleware';
import { bulkReassignLeaderMembers } from '@/src/features/assignments/service';

const requireAdmin = requireRole('ADMIN');

// POST /api/assignments/bulk-reassign-leader — Admin only. body: { outgoingLeaderMemberId,
// incomingLeaderMemberId }. Every member currently assigned to the outgoing Leader moves to
// the incoming one atomically. actorMemberId derived server-side from ctx.memberId, never
// client-supplied, matching the established pattern.
export const POST = (req: NextRequest) =>
  withAuth(req, requireAdmin(async (req, ctx) => {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse('INVALID_BODY', 'Request body required', 400);

    const { outgoingLeaderMemberId, incomingLeaderMemberId } = body;
    if (!outgoingLeaderMemberId || !incomingLeaderMemberId) {
      return errorResponse('MISSING_FIELD', 'outgoingLeaderMemberId and incomingLeaderMemberId required', 400);
    }

    try {
      const result = await bulkReassignLeaderMembers(
        outgoingLeaderMemberId, incomingLeaderMemberId, ctx.tenantId, ctx.memberId
      );
      return NextResponse.json({ data: result });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'VALIDATION_ERROR') return errorResponse('VALIDATION_ERROR', (err as Error).message, 422);
      if (code === 'CROSS_TENANT_ACCESS') return errorResponse('CROSS_TENANT_ACCESS', (err as Error).message, 403);
      throw err;
    }
  }));
