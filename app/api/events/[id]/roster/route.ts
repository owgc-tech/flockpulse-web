import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse, isExactlyLeaderTier } from '@/src/lib/auth/middleware';
import { getEventRoster, assertCallerCanOpenEvent } from '@/src/features/events/service';

const requireLeader = requireRole('LEADER');

// GET /api/events/:id/roster — strictly RSVP-scoped (FP-67 Design Decision): accepted /
// declined / tentative / not-responded, name and guest count; no self-report or attendance data.
//
// FP-240: for every caller who may open the event (Member, Leader or Admin — the same access
// rule as POST /api/events/:id/view, shared in assertCallerCanOpenEvent) this returns the
// FULL invited roster, whatever the caller's role. Two rules on top:
//   - a person's decline reason (rsvp_reason) is returned only to Admin tier, to the leader of
//     that person, and to the person themself — null for every other viewer;
//   - removed members (members.deleted_at set) are not returned, for past and upcoming events.
// An invited Member is therefore no longer refused with 403; a caller who may NOT open the
// event gets 403 FORBIDDEN_SCOPE (404 NOT_FOUND for an unknown or other-tenant event).
//
// The web admin event page keeps the behavior it always had by asking for ?view=admin: Leader
// tier or above only (FORBIDDEN_ROLE otherwise), a Leader scoped to their own assigned members
// (FP-95), removed members included, no redaction. That page reads this route over HTTP (it does
// not call getEventRoster directly), so this opt-in is what keeps it unchanged.
export const GET = (req: NextRequest, { params }: { params: Promise<{ id: string }> }) =>
  withAuth(req, async (_, ctx) => {
    const { id } = await params;
    if (!id) return errorResponse('MISSING_PARAM', 'Event id required', 400);

    if (req.nextUrl.searchParams.get('view') === 'admin') {
      return requireLeader(async () => {
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
      })(req, ctx);
    }

    try {
      await assertCallerCanOpenEvent(ctx.tenantId, ctx.memberId, ctx.role, id);
      const roster = await getEventRoster(id, ctx.tenantId, undefined, {
        viewer: { memberId: ctx.memberId, role: ctx.role },
        hideRemoved: true,
      });
      return NextResponse.json({ data: roster });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'NOT_FOUND') return errorResponse('NOT_FOUND', 'Event not found', 404);
      if (code === 'FORBIDDEN_SCOPE') return errorResponse('FORBIDDEN_SCOPE', (err as Error).message, 403);
      throw err;
    }
  });
