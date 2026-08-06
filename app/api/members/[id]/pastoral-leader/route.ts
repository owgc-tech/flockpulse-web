import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse } from '@/src/lib/auth/middleware';
import { setPastoralLeader } from '@/src/features/assignments/service';

const requireAdmin = requireRole('ADMIN');

// PUT /api/members/:id/pastoral-leader — Admin only. body: { leaderMemberId: string | null }.
// null clears the assignment (no replacement inserted). actorMemberId is derived server-side
// from ctx.memberId, never client-supplied, matching the established pattern.
export const PUT = (req: NextRequest, { params }: { params: Promise<{ id: string }> }) =>
  withAuth(req, requireAdmin(async (req, ctx) => {
    const { id } = await params;
    if (!id) return errorResponse('MISSING_PARAM', 'Member id required', 400);

    const body = await req.json().catch(() => null);
    if (!body || !('leaderMemberId' in body)) {
      return errorResponse('MISSING_FIELD', 'leaderMemberId required (null clears the Assigned Leader)', 400);
    }

    try {
      const result = await setPastoralLeader(id, body.leaderMemberId, ctx.tenantId, ctx.memberId);
      return NextResponse.json({ data: result ?? { cleared: true } });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'CROSS_TENANT_ACCESS') return errorResponse('CROSS_TENANT_ACCESS', (err as Error).message, 403);
      if (code === 'INVALID_TARGET') return errorResponse('INVALID_TARGET', (err as Error).message, 422);
      throw err;
    }
  }));
