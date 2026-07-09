import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse } from '@/src/lib/auth/middleware';
import { getEventById, updateEvent } from '@/src/features/events/service';

const requireAdmin = requireRole('ADMIN');

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
  withAuth(req, requireAdmin(async (req, ctx) => {
    const { id } = await params;
    if (!id) return errorResponse('MISSING_PARAM', 'Event id required', 400);

    const body = await req.json().catch(() => null);
    if (!body) return errorResponse('INVALID_BODY', 'Request body required', 400);

    const {
      name, startDatetime, endDatetime, locationName, locationAddress, locationUrl, target, talkId,
      prayerLeaderMemberId, foodAssignment,
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
        talkId,
        prayerLeaderMemberId,
        foodAssignment,
        actorMemberId: ctx.memberId,
      });
      return NextResponse.json({ data: event });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'NOT_FOUND') return errorResponse('NOT_FOUND', 'Event not found', 404);
      if (code === 'INVALID_STATE') return errorResponse('INVALID_STATE', (err as Error).message, 422);
      if (code === 'IMMUTABLE_FIELD') return errorResponse('IMMUTABLE_FIELD', (err as Error).message, 422);
      if (code === 'INVALID_DATETIME') return errorResponse('INVALID_DATETIME', (err as Error).message, 422);
      if (code === 'INVALID_FORMATION_LINK') return errorResponse('INVALID_FORMATION_LINK', (err as Error).message, 422);
      throw err;
    }
  }));
