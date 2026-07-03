import { NextRequest, NextResponse } from 'next/server';
import { withAuth, errorResponse } from '@/src/lib/auth/middleware';
import { getAssignedMemberIds } from '@/src/features/confirmations/confirmation.repository';
import { computeCourseProgress, computeAllCoursesProgress } from '@/src/features/formation/formation-completion.service';

// GET /api/formation/progress
//   ?member_id=<uuid>   — optional; defaults to caller's own member_id for MEMBER role
//   ?course_id=<uuid>   — optional; if omitted, returns progress for all active courses
//
// RBAC:
//   MEMBER  — may only query their own member_id
//   LEADER  — may query self or any member in their assignments set
//   ADMIN   — may query any tenant member
export async function GET(req: NextRequest) {
  return withAuth(req, async (_, ctx) => {
    const requestedMemberId = req.nextUrl.searchParams.get('member_id') ?? ctx.memberId;
    const courseId = req.nextUrl.searchParams.get('course_id');

    // RBAC scope check
    if (ctx.role === 'MEMBER' && requestedMemberId !== ctx.memberId) {
      return errorResponse('FORBIDDEN_SCOPE', 'Members may only query their own progress', 403);
    }
    if (ctx.role === 'LEADER' && requestedMemberId !== ctx.memberId) {
      const assignedIds = await getAssignedMemberIds(ctx.tenantId, ctx.memberId);
      if (!assignedIds.includes(requestedMemberId)) {
        return errorResponse('FORBIDDEN_SCOPE', 'Leaders may only query their own assigned members', 403);
      }
    }
    // ADMIN: unrestricted within tenant — no extra check needed

    const items = courseId
      ? [await computeCourseProgress(requestedMemberId, courseId, ctx.tenantId)]
      : await computeAllCoursesProgress(requestedMemberId, ctx.tenantId);

    return NextResponse.json({ items }, { status: 200 });
  });
}
