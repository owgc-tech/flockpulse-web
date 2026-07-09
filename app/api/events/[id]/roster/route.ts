import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse } from '@/src/lib/auth/middleware';
import { getEventRoster } from '@/src/features/events/service';

const requireAdmin = requireRole('ADMIN');

// GET /api/events/:id/roster — Admin only. Strictly RSVP-scoped (FP-67 Design
// Decision) — accepted/declined/not-responded only, no self-report or attendance data.
export const GET = (req: NextRequest, { params }: { params: Promise<{ id: string }> }) =>
  withAuth(req, requireAdmin(async (_, ctx) => {
    const { id } = await params;
    if (!id) return errorResponse('MISSING_PARAM', 'Event id required', 400);

    try {
      const roster = await getEventRoster(id, ctx.tenantId);
      return NextResponse.json({ data: roster });
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'NOT_FOUND') {
        return errorResponse('NOT_FOUND', 'Event not found', 404);
      }
      throw err;
    }
  }));
