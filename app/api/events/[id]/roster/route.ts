import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse, isExactlyLeaderTier } from '@/src/lib/auth/middleware';
import { getEventRoster } from '@/src/features/events/service';

const requireLeader = requireRole('LEADER');

// GET /api/events/:id/roster — Admin or Leader. Strictly RSVP-scoped (FP-67 Design
// Decision) — accepted/declined/not-responded only, no self-report or attendance data.
// FP-95: Leader callers get a roster scoped to their own assigned members; Admin
// callers get the full roster, unchanged from FP-67.
export const GET = (req: NextRequest, { params }: { params: Promise<{ id: string }> }) =>
  withAuth(req, requireLeader(async (_, ctx) => {
    const { id } = await params;
    if (!id) return errorResponse('MISSING_PARAM', 'Event id required', 400);

    try {
      // DIP-FP-113-web: rank-based, not a literal `role === 'LEADER'` — a
      // PASTORAL_LEADER caller must get the same scoped-to-own-members
      // roster a LEADER gets, not fall through to the Admin-tier
      // unscoped (undefined) case.
      const roster = await getEventRoster(id, ctx.tenantId, isExactlyLeaderTier(ctx.role) ? ctx.memberId : undefined);
      return NextResponse.json({ data: roster });
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'NOT_FOUND') {
        return errorResponse('NOT_FOUND', 'Event not found', 404);
      }
      throw err;
    }
  }));
