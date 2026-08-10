import { NextRequest, NextResponse } from 'next/server';
import { withAuth, errorResponse } from '@/src/lib/auth/middleware';
import { updateMyUnavailability, deleteMyUnavailability } from '@/src/features/members/member_unavailability.service';

// PATCH /api/members/me/unavailability/:id — DIP-FP-190-web-adj-2: real
// atomic update, closing the edit gap flagged during FP-190's own testing.
// Same self-only scoping and body/error-handling shape as
// POST /api/members/me/unavailability.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return withAuth(req, async (req, ctx) => {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse('INVALID_BODY', 'Request body required', 400);

    try {
      const range = await updateMyUnavailability(id, ctx.memberId, ctx.tenantId, body.startDate, body.endDate);
      return NextResponse.json({ data: range });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'VALIDATION_ERROR') return errorResponse('VALIDATION_ERROR', (err as Error).message, 422);
      if (code === 'NOT_FOUND') return errorResponse('NOT_FOUND', (err as Error).message, 404);
      throw err;
    }
  });
}

// DELETE /api/members/me/unavailability/:id — self-service removal, scoped
// by both id and the caller's own member_id (never trusted from the path
// alone) — matches DELETE /api/members/me's structurally-self-only pattern.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return withAuth(req, async (_, ctx) => {
    try {
      await deleteMyUnavailability(id, ctx.memberId, ctx.tenantId);
      return NextResponse.json({ data: { id } });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'NOT_FOUND') return errorResponse('NOT_FOUND', (err as Error).message, 404);
      throw err;
    }
  });
}
