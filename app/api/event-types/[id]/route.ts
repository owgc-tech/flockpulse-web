import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse } from '@/src/lib/auth/middleware';
import { updateEventType } from '@/src/features/event-types/event-type.service';

// PATCH /api/event-types/:id — update or soft-delete (Admin only)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return withAuth(req, requireRole('ADMIN')(async (_, ctx) => {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse('INVALID_BODY', 'Request body required', 400);

    const { name, code, deleted_at } = body;

    try {
      const updated = await updateEventType(id, ctx.tenantId, {
        name,
        code,
        deletedAt: deleted_at,
      });
      return NextResponse.json({ data: updated }, { status: 200 });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'NOT_FOUND') return errorResponse('NOT_FOUND', (err as Error).message, 404);
      if (code === 'VALIDATION_ERROR') return errorResponse('VALIDATION_ERROR', (err as Error).message, 422);
      throw err;
    }
  }));
}
