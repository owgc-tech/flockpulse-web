import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse } from '@/src/lib/auth/middleware';
import { listGroups, createGroup } from '@/src/features/groups/service';

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
