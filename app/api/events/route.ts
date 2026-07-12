import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse } from '@/src/lib/auth/middleware';
import { createEvent, listEvents } from '@/src/features/events/service';

// DIP-FP-114-web: Leader-tier can create events (scoped to their own via
// created_by_member_id, set server-side from ctx.memberId — never client-supplied).
const requireLeader = requireRole('LEADER');

export async function GET(req: NextRequest) {
  return withAuth(req, async (_, ctx) => {
    const events = await listEvents(ctx.tenantId);
    return NextResponse.json({ data: events });
  });
}

export const POST = (req: NextRequest) =>
  withAuth(req, requireLeader(async (req, ctx) => {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse('INVALID_BODY', 'Request body required', 400);

    const {
      eventTypeId, name, startDatetime, endDatetime, locationName, locationAddress, locationUrl, target, talkId,
      prayerLeaderMemberId, foodAssignment,
    } = body;
    if (!eventTypeId || !name || !startDatetime || !endDatetime || !locationName || !locationAddress || !target) {
      return errorResponse('MISSING_FIELD', 'eventTypeId, name, startDatetime, endDatetime, locationName, locationAddress, target required', 400);
    }

    try {
      const event = await createEvent({
        tenantId: ctx.tenantId,
        eventTypeId,
        name,
        startDatetime,
        endDatetime,
        locationName,
        locationAddress,
        locationUrl,
        target,
        talkId,
        prayerLeaderMemberId,
        foodAssignment,
        actorMemberId: ctx.memberId,
      });
      return NextResponse.json({ data: event }, { status: 201 });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'INVALID_DATETIME') return errorResponse('INVALID_DATETIME', (err as Error).message, 422);
      if (code === 'INVALID_TARGET') return errorResponse('INVALID_TARGET', (err as Error).message, 422);
      if (code === 'INVALID_FORMATION_LINK') return errorResponse('INVALID_FORMATION_LINK', (err as Error).message, 422);
      throw err;
    }
  }));
