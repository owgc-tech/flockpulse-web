import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse, isExactlyLeaderTier } from '@/src/lib/auth/middleware';
import { getEventById, updateEvent } from '@/src/features/events/service';

// DIP-FP-114-web: rank-based, not a literal `role === 'LEADER'` — see
// isExactlyLeaderTier's own doc comment for why this must be rank-based
// (a PASTORAL_LEADER caller needs the same ownership scoping a LEADER gets).
const requireLeader = requireRole('LEADER');

export const GET = (req: NextRequest, { params }: { params: Promise<{ id: string }> }) =>
  withAuth(req, async (_, ctx) => {
    const { id } = await params;
    if (!id) return errorResponse('MISSING_PARAM', 'Event id required', 400);

    try {
      const event = await getEventById(id, ctx.tenantId);
      return NextResponse.json({ data: event });
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'NOT_FOUND') {
        return errorResponse('NOT_FOUND', 'Event not found', 404);
      }
      throw err;
    }
  });

export const PATCH = (req: NextRequest, { params }: { params: Promise<{ id: string }> }) =>
  withAuth(req, requireLeader(async (req, ctx) => {
    const { id } = await params;
    if (!id) return errorResponse('MISSING_PARAM', 'Event id required', 400);

    const body = await req.json().catch(() => null);
    if (!body) return errorResponse('INVALID_BODY', 'Request body required', 400);

    const {
      name, startDatetime, endDatetime, locationName, locationAddress, locationUrl, target, eventTypeId, talkId,
      prayerLeaderMemberId, foodAssignment, onlineMeetingResourceId, onlineMeetingUrl, onlineMeetingPlatformLabel,
      rsvpClosureDays,
    } = body;

    try {
      const event = await updateEvent(id, ctx.tenantId, {
        name,
        startDatetime,
        endDatetime,
        locationName,
        locationAddress,
        locationUrl,
        target,
        eventTypeId,
        talkId,
        prayerLeaderMemberId,
        foodAssignment,
        onlineMeetingResourceId,
        onlineMeetingUrl,
        onlineMeetingPlatformLabel,
        rsvpClosureDays,
        actorMemberId: ctx.memberId,
      }, isExactlyLeaderTier(ctx.role) ? ctx.memberId : undefined);
      return NextResponse.json({ data: event });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'NOT_FOUND') return errorResponse('NOT_FOUND', 'Event not found', 404);
      if (code === 'FORBIDDEN_SCOPE') return errorResponse('FORBIDDEN_SCOPE', (err as Error).message, 403);
      if (code === 'INVALID_STATE') return errorResponse('INVALID_STATE', (err as Error).message, 422);
      if (code === 'IMMUTABLE_FIELD') return errorResponse('IMMUTABLE_FIELD', (err as Error).message, 422);
      if (code === 'INVALID_DATETIME') return errorResponse('INVALID_DATETIME', (err as Error).message, 422);
      if (code === 'INVALID_VALUE') return errorResponse('INVALID_VALUE', (err as Error).message, 422);
      if (code === 'INVALID_TARGET') return errorResponse('INVALID_TARGET', (err as Error).message, 422);
      if (code === 'INVALID_FORMATION_LINK') return errorResponse('INVALID_FORMATION_LINK', (err as Error).message, 422);
      // DIP-FP-120-web: see app/api/events/route.ts's POST handler for the
      // identical rationale — 409 with structured conflict detail when
      // available, generic message-only for the race-condition path.
      if (code === 'MEETING_RESOURCE_CONFLICT') {
        return NextResponse.json(
          { error: { code, message: (err as Error).message, conflict: (err as { conflict?: unknown }).conflict ?? null } },
          { status: 409 }
        );
      }
      throw err;
    }
  }));
