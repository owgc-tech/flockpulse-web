import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse } from '@/src/lib/auth/middleware';
import {
  listAssignments,
  createGroupAssignment,
  createLeaderAssignment,
  softDeleteAssignment,
} from '@/src/features/assignments/service';

const requireAdmin = requireRole('ADMIN');

export async function GET(req: NextRequest) {
  return withAuth(req, async (_, ctx) => {
    const assignments = await listAssignments(ctx.tenantId);
    return NextResponse.json({ data: assignments });
  });
}

export const POST = (req: NextRequest) =>
  withAuth(req, requireAdmin(async (req, ctx) => {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse('INVALID_BODY', 'Request body required', 400);

    const { memberId, assignmentType, groupId, leaderMemberId } = body;
    if (!memberId || !assignmentType) {
      return errorResponse('MISSING_FIELD', 'memberId and assignmentType required', 400);
    }

    try {
      if (assignmentType === 'GROUP') {
        if (!groupId) return errorResponse('MISSING_FIELD', 'groupId required for GROUP assignment', 400);
        const assignment = await createGroupAssignment({ tenantId: ctx.tenantId, memberId, groupId });
        return NextResponse.json({ data: assignment }, { status: 201 });
      }

      if (assignmentType === 'LEADER') {
        if (!leaderMemberId) return errorResponse('MISSING_FIELD', 'leaderMemberId required for LEADER assignment', 400);
        const assignment = await createLeaderAssignment({ tenantId: ctx.tenantId, memberId, leaderMemberId });
        return NextResponse.json({ data: assignment }, { status: 201 });
      }

      return errorResponse('INVALID_TYPE', 'assignmentType must be GROUP or LEADER', 400);
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'DUPLICATE_ASSIGNMENT') {
        return errorResponse('DUPLICATE_ASSIGNMENT', (err as Error).message, 409);
      }
      throw err;
    }
  }));

export const DELETE = (req: NextRequest) =>
  withAuth(req, requireAdmin(async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return errorResponse('MISSING_PARAM', 'id query param required', 400);

    await softDeleteAssignment(id, ctx.tenantId);
    return NextResponse.json({ data: { id, deleted: true } });
  }));
