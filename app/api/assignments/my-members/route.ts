import { NextRequest, NextResponse } from 'next/server';
import { withAuth, errorResponse } from '@/src/lib/auth/middleware';
import { getMyAssignedMembers } from '@/src/features/assignments/service';

// FP-7: Leader-scoped read endpoint.
// Returns members assigned to the calling user as their leader.
// MEMBER role is rejected — only LEADER and ADMIN may call this endpoint.
export async function GET(req: NextRequest) {
  return withAuth(req, async (_, ctx) => {
    if (ctx.role === 'MEMBER') {
      return errorResponse('FORBIDDEN_ROLE', 'Requires LEADER or ADMIN', 403);
    }

    // ADMIN calling this gets members assigned to them as leader (may be empty).
    // To get all assignments across leaders, use GET /api/assignments instead.
    const members = await getMyAssignedMembers(ctx.tenantId, ctx.memberId);
    return NextResponse.json({ data: members });
  });
}
