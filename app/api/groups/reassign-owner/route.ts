import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse } from '@/src/lib/auth/middleware';
import { reassignGroupOwner } from '@/src/features/groups/service';

const requireAdmin = requireRole('ADMIN');

// POST /api/groups/reassign-owner — Admin only. body: { groupId, newOwnerMemberId }.
// actorMemberId derived server-side from ctx.memberId, never client-supplied, matching the
// established pattern (e.g. bulk-reassign-leader).
export const POST = (req: NextRequest) =>
  withAuth(req, requireAdmin(async (req, ctx) => {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse('INVALID_BODY', 'Request body required', 400);

    const { groupId, newOwnerMemberId } = body;
    if (!groupId || !newOwnerMemberId) {
      return errorResponse('MISSING_FIELD', 'groupId and newOwnerMemberId required', 400);
    }

    try {
      const result = await reassignGroupOwner(groupId, ctx.tenantId, newOwnerMemberId, ctx.memberId);
      return NextResponse.json({ data: result });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'NOT_FOUND_IN_TENANT') return errorResponse('NOT_FOUND_IN_TENANT', 'Group not found for this tenant', 404);
      if (code === 'VALIDATION_ERROR') return errorResponse('VALIDATION_ERROR', (err as Error).message, 422);
      throw err;
    }
  }));
