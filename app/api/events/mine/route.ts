import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/src/lib/auth/middleware';
import { listEventsForMember } from '@/src/features/events/service';

// GET /api/events/mine — FP-94/FP-66: member-scoped "my events" with the caller's
// own rsvp_status/rsvp_reason attached. Any authenticated member may call this;
// role is not restricted above MEMBER — inherently self-scoped via ctx.memberId.
// FP-223: ctx.role widens what "mine" includes — Leader-tier also gets events
// they own, Admin-tier gets every event in the tenant (see listEventsForMember).
export async function GET(req: NextRequest) {
  return withAuth(req, async (_, ctx) => {
    const events = await listEventsForMember(ctx.tenantId, ctx.memberId, ctx.role);
    return NextResponse.json({ data: events });
  });
}
