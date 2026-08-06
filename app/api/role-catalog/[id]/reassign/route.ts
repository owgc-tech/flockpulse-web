import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse } from '@/src/lib/auth/middleware';
import { reassignRoleCatalogEntryEntries } from '@/src/features/role-catalog/role-catalog.service';

const requireAdmin = requireRole('ADMIN');

// POST /api/role-catalog/:id/reassign — moves every active member and pending
// invitation off :id onto body.toEntryId, same tier only (Admin only).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return withAuth(req, requireAdmin(async (_, ctx) => {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse('INVALID_BODY', 'Request body required', 400);

    const { toEntryId } = body;
    if (!toEntryId) return errorResponse('MISSING_FIELD', 'toEntryId required', 400);

    try {
      const result = await reassignRoleCatalogEntryEntries(id, toEntryId, ctx.tenantId);
      return NextResponse.json({ data: result }, { status: 200 });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'VALIDATION_ERROR') return errorResponse('VALIDATION_ERROR', (err as Error).message, 422);
      if (code === 'NOT_FOUND_IN_TENANT') return errorResponse('NOT_FOUND_IN_TENANT', (err as Error).message, 404);
      if (code === 'TIER_MISMATCH') return errorResponse('TIER_MISMATCH', (err as Error).message, 422);
      throw err;
    }
  }));
}
