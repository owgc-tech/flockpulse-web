import { NextRequest, NextResponse } from 'next/server';
import { withAuth, errorResponse } from '@/src/lib/auth/middleware';
import { deleteMyUnavailability } from '@/src/features/members/member_unavailability.service';

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
