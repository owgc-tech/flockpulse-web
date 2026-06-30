import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse } from '@/src/lib/auth/middleware';
import { updateEvent } from '@/src/features/events/service';

const requireAdmin = requireRole('ADMIN');

export const PATCH = (req: NextRequest, { params }: { params: Promise<{ id: string }> }) =>
  withAuth(req, requireAdmin(async (req, ctx) => {
    const { id } = await params;
    if (!id) return errorResponse('MISSING_PARAM', 'Event id required', 400);

    const body = await req.json().catch(() => null);
    if (!body) return errorResponse('INVALID_BODY', 'Request body required', 400);

    const { name, startDatetime, endDatetime, locationName, target, talkId } = body;

    try {
      const event = await updateEvent(id, ctx.tenantId, {
        name,
        startDatetime,
        endDatetime,
        locationName,
        target,
        talkId,
      });
      return NextResponse.json({ data: event });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'NOT_FOUND') return errorResponse('NOT_FOUND', 'Event not found', 404);
      if (code === 'INVALID_STATE') return errorResponse('INVALID_STATE', (err as Error).message, 422);
      if (code === 'IMMUTABLE_FIELD') return errorResponse('IMMUTABLE_FIELD', (err as Error).message, 422);
      if (code === 'INVALID_DATETIME') return errorResponse('INVALID_DATETIME', (err as Error).message, 422);
      throw err;
    }
  }));
