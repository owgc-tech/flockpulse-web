import { NextRequest, NextResponse } from 'next/server';
import { withAuth, errorResponse } from '@/src/lib/auth/middleware';
import { submitRsvp } from '@/src/features/rsvps/rsvp.service';

// POST /api/rsvps — Member submits pre-event attendance intent (RSVP).
// Any authenticated member may call this; role is not restricted above MEMBER.
// tenant_id and member_id are resolved server-side from the JWT — never from the request body.
export async function POST(req: NextRequest) {
  return withAuth(req, async (_, ctx) => {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse('INVALID_BODY', 'Request body required', 400);

    const { event_id, rsvp_status, rsvp_reason } = body;

    if (!event_id) return errorResponse('MISSING_FIELD', 'event_id required', 400);
    if (!rsvp_status) return errorResponse('MISSING_FIELD', 'rsvp_status required', 400);
    if (rsvp_status !== 'YES' && rsvp_status !== 'NO' && rsvp_status !== 'TENTATIVE') {
      return errorResponse('INVALID_VALUE', 'rsvp_status must be YES, NO, or TENTATIVE', 400);
    }

    try {
      const rsvp = await submitRsvp(ctx.tenantId, ctx.memberId, {
        eventId: event_id,
        rsvpStatus: rsvp_status,
        rsvpReason: rsvp_reason,
      });
      return NextResponse.json({ data: rsvp }, { status: 201 });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'NOT_FOUND') return errorResponse('NOT_FOUND', (err as Error).message, 404);
      if (code === 'NOT_AN_ATTENDEE') return errorResponse('NOT_AN_ATTENDEE', (err as Error).message, 403);
      if (code === 'INVALID_STATE') return errorResponse('INVALID_STATE', (err as Error).message, 422);
      if (code === 'RSVP_CLOSED') return errorResponse('RSVP_CLOSED', (err as Error).message, 422);
      if (code === 'RSVP_REASON_REQUIRED') return errorResponse('RSVP_REASON_REQUIRED', (err as Error).message, 422);
      throw err;
    }
  });
}
