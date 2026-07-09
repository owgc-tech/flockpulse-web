import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse } from '@/src/lib/auth/middleware';
import { createEventType, listEventTypes } from '@/src/features/event-types/event-type.service';

// GET /api/event-types — list active event types for the tenant (any authenticated member)
export async function GET(req: NextRequest) {
  return withAuth(req, async (_, ctx) => {
    const eventTypes = await listEventTypes(ctx.tenantId);
    return NextResponse.json({ data: eventTypes }, { status: 200 });
  });
}

// POST /api/event-types — create an event type (Admin only)
export async function POST(req: NextRequest) {
  return withAuth(req, requireRole('ADMIN')(async (_, ctx) => {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse('INVALID_BODY', 'Request body required', 400);

    const { name, code } = body;
    if (!name) return errorResponse('MISSING_FIELD', 'name required', 400);
    if (!code) return errorResponse('MISSING_FIELD', 'code required', 400);

    try {
      const eventType = await createEventType(ctx.tenantId, { name, code });
      return NextResponse.json({ data: eventType }, { status: 201 });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'VALIDATION_ERROR') return errorResponse('VALIDATION_ERROR', (err as Error).message, 422);
      throw err;
    }
  }));
}
