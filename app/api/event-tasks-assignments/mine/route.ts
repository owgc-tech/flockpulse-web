import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/src/lib/auth/middleware';
import { listMyTaskAssignments } from '@/src/features/tasks/eventTaskAssignment.service';

// GET /api/event-tasks-assignments/mine — FP-161-5: member-scoped "My Tasks",
// mirroring GET /api/events/mine exactly. Any authenticated member may call this;
// role is not restricted above MEMBER — inherently self-scoped via ctx.memberId.
export async function GET(req: NextRequest) {
  return withAuth(req, async (_, ctx) => {
    const assignments = await listMyTaskAssignments(ctx.tenantId, ctx.memberId);
    return NextResponse.json({ data: assignments });
  });
}
