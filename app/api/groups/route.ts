import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, isAdminTier, errorResponse } from '@/src/lib/auth/middleware';
import { listGroups, getGroupById, createGroup, updateGroup, softDeleteGroup } from '@/src/features/groups/service';

const requireAdmin = requireRole('ADMIN');
const requireLeader = requireRole('LEADER');

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

// FP-146: widened from Admin-only to Leader-tier — any Leader-tier account can create a
// group (becoming its owner_member_id via create_group_with_audit).
export const POST = (req: NextRequest) =>
  withAuth(req, requireLeader(async (req, ctx) => {
    const body = await req.json().catch(() => null);
    if (!body?.name) return errorResponse('MISSING_FIELD', 'name required', 400);

    const group = await createGroup(ctx.tenantId, body.name, ctx.memberId);
    return NextResponse.json({ data: group }, { status: 201 });
  }));

// FP-146: widened from Admin-only to Leader-tier, per the story's AC ("Leader-tier: sees
// every group... can edit only groups where owner_member_id = themselves"). Non-Admin-tier
// callers are additionally checked against the group's owner_member_id here — Admin-tier
// bypasses this check and can rename any group, matching existing Admin-tier reach elsewhere.
export const PATCH = (req: NextRequest) =>
  withAuth(req, requireLeader(async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return errorResponse('MISSING_PARAM', 'id query param required', 400);

    const body = await req.json().catch(() => null);
    if (!body?.name) return errorResponse('MISSING_FIELD', 'name required', 400);

    try {
      if (!isAdminTier(ctx.role)) {
        const existing = await getGroupById(id, ctx.tenantId);
        if ((existing as { owner_member_id: string | null }).owner_member_id !== ctx.memberId) {
          return errorResponse('FORBIDDEN_ROLE', 'Only the group owner or an Admin can edit this group', 403);
        }
      }

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
