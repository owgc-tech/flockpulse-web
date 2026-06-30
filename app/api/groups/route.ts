import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse } from '@/src/lib/auth/middleware';
import { listGroups, createGroup, updateGroup } from '@/src/features/groups/service';

const requireAdmin = requireRole('ADMIN');

export async function GET(req: NextRequest) {
  return withAuth(req, async (_, ctx) => {
    const groups = await listGroups(ctx.tenantId);
    return NextResponse.json({ data: groups });
  });
}

export const POST = (req: NextRequest) =>
  withAuth(req, requireAdmin(async (req, ctx) => {
    const body = await req.json().catch(() => null);
    if (!body?.name) return errorResponse('MISSING_FIELD', 'name required', 400);

    const group = await createGroup(ctx.tenantId, body.name);
    return NextResponse.json({ data: group }, { status: 201 });
  }));

export const PATCH = (req: NextRequest) =>
  withAuth(req, requireAdmin(async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return errorResponse('MISSING_PARAM', 'id query param required', 400);

    const body = await req.json().catch(() => null);
    if (!body?.name) return errorResponse('MISSING_FIELD', 'name required', 400);

    const group = await updateGroup(id, ctx.tenantId, body.name);
    return NextResponse.json({ data: group });
  }));
