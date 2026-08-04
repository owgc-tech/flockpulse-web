import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse } from '@/src/lib/auth/middleware';
import { createEvent, listEvents } from '@/src/features/events/service';

// DIP-FP-114-web: Leader-tier can create events (scoped to their own via
// created_by_member_id, set server-side from ctx.memberId — never client-supplied).
const requireLeader = requireRole('LEADER');

// FP-167-1: pagination + filter query params for the admin Events page's
// infinite scroll. All optional — omitting them preserves "first page,
// unfiltered" behavior. eventTypeIds/status are comma-separated ids/values;
// month is 'YYYY-MM'. See listEvents() for how each is actually applied.
export async function GET(req: NextRequest) {
  return withAuth(req, async (_, ctx) => {
    const { searchParams } = req.nextUrl;
    const limitParam = searchParams.get('limit');
    const offsetParam = searchParams.get('offset');
    const eventTypeIdsParam = searchParams.get('eventTypeIds');
    const monthParam = searchParams.get('month');
    const statusParam = searchParams.get('status');

    const result = await listEvents(ctx.tenantId, {
      limit: limitParam ? Number(limitParam) : undefined,
      offset: offsetParam ? Number(offsetParam) : undefined,
      eventTypeIds: eventTypeIdsParam ? eventTypeIdsParam.split(',').filter(Boolean) : undefined,
      month: monthParam ?? undefined,
      status: statusParam ? statusParam.split(',').filter(Boolean) : undefined,
    });
    return NextResponse.json(result);
  });
}

export const POST = (req: NextRequest) =>
  withAuth(req, requireLeader(async (req, ctx) => {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse('INVALID_BODY', 'Request body required', 400);

    const {
      eventTypeId, name, startDatetime, endDatetime, locationName, locationAddress, locationUrl, target, talkId,
      onlineMeetingResourceId, onlineMeetingUrl, onlineMeetingPlatformLabel,
      rsvpClosureDays, announcementBody, guestsAllowed,
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
        onlineMeetingResourceId,
        onlineMeetingUrl,
        onlineMeetingPlatformLabel,
        rsvpClosureDays,
        announcementBody,
        guestsAllowed,
        actorMemberId: ctx.memberId,
      });
      return NextResponse.json({ data: event }, { status: 201 });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'INVALID_DATETIME') return errorResponse('INVALID_DATETIME', (err as Error).message, 422);
      if (code === 'INVALID_VALUE') return errorResponse('INVALID_VALUE', (err as Error).message, 422);
      if (code === 'INVALID_TARGET') return errorResponse('INVALID_TARGET', (err as Error).message, 422);
      if (code === 'INVALID_FORMATION_LINK') return errorResponse('INVALID_FORMATION_LINK', (err as Error).message, 422);
      if (code === 'ANNOUNCEMENT_MISSING_EVERYONE_GROUP') return errorResponse('ANNOUNCEMENT_MISSING_EVERYONE_GROUP', (err as Error).message, 422);
      // DIP-FP-120-web: 409 with the structured conflict detail (when the
      // pre-check found one) so the client can render "This account is
      // already booked for [Event Name] on [date/time] by [Name]" — the rare
      // race-condition path (meetingResourceRaceError()) has no `conflict`
      // detail, only the generic message, and that's expected.
      if (code === 'MEETING_RESOURCE_CONFLICT') {
        return NextResponse.json(
          { error: { code, message: (err as Error).message, conflict: (err as { conflict?: unknown }).conflict ?? null } },
          { status: 409 }
        );
      }
      throw err;
    }
  }));
