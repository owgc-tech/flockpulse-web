import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse } from '@/src/lib/auth/middleware';
import { listRoleCatalog, createRoleCatalogEntry } from '@/src/features/role-catalog/role-catalog.service';

const requireAdmin = requireRole('ADMIN');

// GET /api/role-catalog — any authenticated member (MemberEditForm/InviteForm
// need this to populate their role dropdowns; matches GET /api/event-types'
// same "any authenticated member" precedent).
export async function GET(req: NextRequest) {
  return withAuth(req, async (_, ctx) => {
    const { searchParams } = req.nextUrl;
    const includeDeleted = searchParams.get('includeDeleted') === 'true';
    const entries = await listRoleCatalog(ctx.tenantId, includeDeleted);
    return NextResponse.json({ data: entries }, { status: 200 });
  });
}

// POST /api/role-catalog — create an entry (Admin only).
export async function POST(req: NextRequest) {
  return withAuth(req, requireAdmin(async (_, ctx) => {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse('INVALID_BODY', 'Request body required', 400);

    const { name, tier } = body;
    if (!name) return errorResponse('MISSING_FIELD', 'name required', 400);
    if (!tier) return errorResponse('MISSING_FIELD', 'tier required', 400);

    try {
      const entry = await createRoleCatalogEntry(ctx.tenantId, { name, tier });
      return NextResponse.json({ data: entry }, { status: 201 });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'VALIDATION_ERROR') return errorResponse('VALIDATION_ERROR', (err as Error).message, 422);
      throw err;
    }
  }));
}
