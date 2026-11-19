import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse } from '@/src/lib/auth/middleware';
import { cancelRemainingInSeries } from '@/src/features/events/event-series.service';

const requireAdmin = requireRole('ADMIN');

// POST /api/event-series/:id/cancel-remaining — Admin only. Irreversible. actorMemberId
// derived server-side from ctx.memberId, never client-supplied.
export const POST = (req: NextRequest, { params }: { params: Promise<{ id: string }> }) =>
  withAuth(req, requireAdmin(async (_, ctx) => {
    const { id } = await params;
    if (!id) return errorResponse('MISSING_PARAM', 'Series id required', 400);

    try {
      const result = await cancelRemainingInSeries(id, ctx.tenantId, ctx.memberId);
      return NextResponse.json({ data: result });
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'NOT_FOUND') {
        return errorResponse('NOT_FOUND', 'No events found for this series', 404);
      }
      throw err;
    }
  }));
