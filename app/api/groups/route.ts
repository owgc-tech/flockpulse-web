import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse } from '@/src/lib/auth/middleware';
import { listGroups, getGroupById, createGroup, updateGroup, softDeleteGroup } from '@/src/features/groups/service';

const requireAdmin = requireRole('ADMIN');

// GET /api/groups — list (?includeDeleted=true to show status, per FP-70's List screen)
// GET /api/groups?id=... — single group, for FP-70 Edit-screen prefill
export async function GET(req: NextRequest) {
  return withAuth(req, async (_, ctx) => {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (id) {
      try {
        const group = await getGroupById(id, ctx.tenantId);
        return NextResponse.json({ data: group });
      } catch (err: unknown) {
        if ((err as { code?: string }).code === 'NOT_FOUND_IN_TENANT') {
          return errorResponse('NOT_FOUND_IN_TENANT', 'Group not found for this tenant', 404);
        }
        throw err;
      }
    }

    const includeDeleted = searchParams.get('includeDeleted') === 'true';
    const groups = await listGroups(ctx.tenantId, includeDeleted);
    return NextResponse.json({ data: groups });
  });
}

export const POST = (req: NextRequest) =>
  withAuth(req, requireAdmin(async (req, ctx) => {
    const body = await req.json().catch(() => null);
    if (!body?.name) return errorResponse('MISSING_FIELD', 'name required', 400);

    const group = await createGroup(ctx.tenantId, body.name, ctx.memberId);
    return NextResponse.json({ data: group }, { status: 201 });
  }));

export const PATCH = (req: NextRequest) =>
  withAuth(req, requireAdmin(async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return errorResponse('MISSING_PARAM', 'id query param required', 400);

    const body = await req.json().catch(() => null);
    if (!body?.name) return errorResponse('MISSING_FIELD', 'name required', 400);

    try {
      const group = await updateGroup(id, ctx.tenantId, body.name, ctx.memberId);
      return NextResponse.json({ data: group });
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'NOT_FOUND_IN_TENANT') {
        return errorResponse('NOT_FOUND_IN_TENANT', 'Group not found for this tenant', 404);
      }
      throw err;
    }
  }));

export const DELETE = (req: NextRequest) =>
  withAuth(req, requireAdmin(async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return errorResponse('MISSING_PARAM', 'id query param required', 400);

    try {
      await softDeleteGroup(id, ctx.tenantId, ctx.memberId);
      return NextResponse.json({ data: { id, deleted: true } });
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'NOT_FOUND_IN_TENANT') {
        return errorResponse('NOT_FOUND_IN_TENANT', 'Group not found for this tenant', 404);
      }
      throw err;
    }
  }));
