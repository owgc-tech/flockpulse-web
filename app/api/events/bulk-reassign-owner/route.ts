import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse } from '@/src/lib/auth/middleware';
import { bulkReassignEventOwner } from '@/src/features/events/service';

const requireAdmin = requireRole('ADMIN');

// POST /api/events/bulk-reassign-owner — Admin only. body: { outgoingOwnerMemberId,
// incomingOwnerMemberId }. Every event currently owned by the outgoing owner moves to the
// incoming one atomically. Mirrors groups/bulk-reassign-owner exactly; API-only, no dedicated
// UI page, matching that same precedent.
export const POST = (req: NextRequest) =>
  withAuth(req, requireAdmin(async (req, ctx) => {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse('INVALID_BODY', 'Request body required', 400);

    const { outgoingOwnerMemberId, incomingOwnerMemberId } = body;
    if (!outgoingOwnerMemberId || !incomingOwnerMemberId) {
      return errorResponse('MISSING_FIELD', 'outgoingOwnerMemberId and incomingOwnerMemberId required', 400);
    }

    try {
      const result = await bulkReassignEventOwner(
        outgoingOwnerMemberId, incomingOwnerMemberId, ctx.tenantId, ctx.memberId
      );
      return NextResponse.json({ data: result });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'VALIDATION_ERROR') return errorResponse('VALIDATION_ERROR', (err as Error).message, 422);
      if (code === 'CROSS_TENANT_ACCESS') return errorResponse('CROSS_TENANT_ACCESS', (err as Error).message, 403);
      throw err;
    }
  }));
