import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse } from '@/src/lib/auth/middleware';
import { getEventById } from '@/src/features/events/service';
import { convertEventToSeries } from '@/src/features/events/event-series.service';

const requireAdmin = requireRole('ADMIN');

// POST /api/events/:id/convert-to-series — Admin only. actorMemberId derived server-side
// from ctx.memberId, never client-supplied. The event's own current start/end datetime are
// read server-side (not trusted from the client body) so the occurrence sequence is always
// computed from what's actually stored, not from what the caller claims.
export const POST = (req: NextRequest, { params }: { params: Promise<{ id: string }> }) =>
  withAuth(req, requireAdmin(async (req, ctx) => {
    const { id } = await params;
    if (!id) return errorResponse('MISSING_PARAM', 'Event id required', 400);

    const body = await req.json().catch(() => null);
    if (!body) return errorResponse('INVALID_BODY', 'Request body required', 400);

    const { frequency, mode, count, untilDate } = body;

    if (!frequency || !['WEEKLY', 'FORTNIGHTLY', 'MONTHLY'].includes(frequency)) {
      return errorResponse('MISSING_FIELD', 'frequency must be WEEKLY, FORTNIGHTLY, or MONTHLY', 400);
    }
    if (mode !== 'COUNT' && mode !== 'UNTIL') {
      return errorResponse('MISSING_FIELD', 'mode must be COUNT or UNTIL', 400);
    }
    if (mode === 'COUNT' && (!count || count < 1)) {
      return errorResponse('MISSING_FIELD', 'count required and must be at least 1 for mode=COUNT', 400);
    }
    if (mode === 'UNTIL' && !untilDate) {
      return errorResponse('MISSING_FIELD', 'untilDate required for mode=UNTIL', 400);
    }

    try {
      const event = await getEventById(id, ctx.tenantId);

      const result = await convertEventToSeries({
        eventId: id,
        tenantId: ctx.tenantId,
        startDatetime: new Date(event.start_datetime),
        endDatetime: new Date(event.end_datetime),
        frequency,
        mode,
        countOrUntil: mode === 'COUNT' ? count : new Date(untilDate),
        actorMemberId: ctx.memberId,
      });

      return NextResponse.json({ data: result }, { status: 201 });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'NOT_FOUND') return errorResponse('NOT_FOUND', 'Event not found', 404);
      if (code === 'VALIDATION_ERROR') return errorResponse('VALIDATION_ERROR', (err as Error).message, 422);
      if (code === 'INVALID_STATE_TRANSITION') return errorResponse('INVALID_STATE_TRANSITION', (err as Error).message, 422);
      throw err;
    }
  }));
