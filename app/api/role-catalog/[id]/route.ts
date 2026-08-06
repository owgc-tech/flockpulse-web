import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse } from '@/src/lib/auth/middleware';
import { updateRoleCatalogEntry } from '@/src/features/role-catalog/role-catalog.service';

const requireAdmin = requireRole('ADMIN');

// PATCH /api/role-catalog/:id — rename or soft-delete (Admin only). tier is
// deliberately not accepted here — see role-catalog.types.ts's
// UpdateRoleCatalogEntryInput comment.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return withAuth(req, requireAdmin(async (_, ctx) => {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse('INVALID_BODY', 'Request body required', 400);

    const { name, deleted_at } = body;

    try {
      const updated = await updateRoleCatalogEntry(id, ctx.tenantId, {
        name,
        deletedAt: deleted_at,
      });
      return NextResponse.json({ data: updated }, { status: 200 });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'NOT_FOUND') return errorResponse('NOT_FOUND', (err as Error).message, 404);
      if (code === 'VALIDATION_ERROR') return errorResponse('VALIDATION_ERROR', (err as Error).message, 422);
      if (code === 'INVALID_STATE_TRANSITION') {
        const memberCount = (err as { memberCount?: number }).memberCount;
        const invitationCount = (err as { invitationCount?: number }).invitationCount;
        return NextResponse.json(
          { error: { code, message: (err as Error).message, memberCount, invitationCount } },
          { status: 409 }
        );
      }
      throw err;
    }
  }));
}
