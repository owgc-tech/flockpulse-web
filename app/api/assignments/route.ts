import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse } from '@/src/lib/auth/middleware';
import {
  listAssignments,
  getMembersAssignedToLeader,
  createGroupAssignment,
  createLeaderAssignment,
  softDeleteAssignment,
} from '@/src/features/assignments/service';

const requireAdmin = requireRole('ADMIN');

// GET /api/assignments — all tenant assignments, open to any authenticated role (unchanged).
// GET /api/assignments?leaderMemberId=... — Admin only (FP-73/FP-74): who's currently
// assigned to an arbitrary leader, backing the Bulk Reassign screen and the
// blocked-deactivation UI. Gated separately from the base GET, which returns everything to
// any role — this lookup targets one specific leader's roster and is an Admin-only workflow.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const leaderMemberId = searchParams.get('leaderMemberId');

  if (leaderMemberId) {
    return withAuth(req, requireAdmin(async (_, ctx) => {
      const members = await getMembersAssignedToLeader(leaderMemberId, ctx.tenantId);
      return NextResponse.json({ data: members });
    }));
  }

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

    // DIP-FP-181: trigger_block_manual_removal_from_system_group blocks
    // removing an active member from a system-managed group (e.g. Everyone)
    // — 409, matching the existing INVALID_STATE_TRANSITION convention's
    // status code exactly.
    try {
      await softDeleteAssignment(id, ctx.tenantId);
      return NextResponse.json({ data: { id, deleted: true } });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'SYSTEM_MANAGED_GROUP') {
        return errorResponse('SYSTEM_MANAGED_GROUP', (err as Error).message, 409);
      }
      throw err;
    }
  }));
