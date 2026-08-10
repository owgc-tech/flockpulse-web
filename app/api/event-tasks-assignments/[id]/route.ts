import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse } from '@/src/lib/auth/middleware';
import { updateTaskAssignment, deleteTaskAssignment } from '@/src/features/tasks/eventTaskAssignment.service';

// Leader-tier-or-above, matching POST /api/event-tasks-assignments.
const requireLeader = requireRole('LEADER');

// PATCH /api/event-tasks-assignments/:id — update the assignee (Leader-tier-or-above)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return withAuth(req, requireLeader(async (_, ctx) => {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse('INVALID_BODY', 'Request body required', 400);

    const { assignee } = body;

    try {
      const updated = await updateTaskAssignment(id, ctx.tenantId, { assignee });
      return NextResponse.json({ data: updated }, { status: 200 });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'NOT_FOUND') return errorResponse('NOT_FOUND', (err as Error).message, 404);
      if (code === 'VALIDATION_ERROR') return errorResponse('VALIDATION_ERROR', (err as Error).message, 422);
      // DIP-FP-190-web: same memberName-attached shape as POST /api/event-tasks-assignments.
      if (code === 'MEMBER_UNAVAILABLE') {
        return NextResponse.json(
          { error: { code, message: (err as Error).message, memberName: (err as { memberName?: string }).memberName } },
          { status: 422 }
        );
      }
      throw err;
    }
  }));
}

// DELETE /api/event-tasks-assignments/:id — hard-delete (Leader-tier-or-above)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return withAuth(req, requireLeader(async (_, ctx) => {
    try {
      await deleteTaskAssignment(id, ctx.tenantId);
      return NextResponse.json({ data: { id } }, { status: 200 });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'NOT_FOUND') return errorResponse('NOT_FOUND', (err as Error).message, 404);
      throw err;
    }
  }));
}
