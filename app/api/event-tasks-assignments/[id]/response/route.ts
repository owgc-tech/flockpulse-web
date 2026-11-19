import { NextRequest, NextResponse } from 'next/server';
import { withAuth, errorResponse } from '@/src/lib/auth/middleware';
import { submitTaskAssignmentResponse } from '@/src/features/tasks/eventTaskAssignment.service';

// POST /api/event-tasks-assignments/:id/response — FP-221: the calling member
// commits to or refuses their task assignment. Any authenticated member may call
// it; whether they are actually an assignee is enforced in the service/SQL.
// Tenant and member come from the JWT context only, never the request body.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return withAuth(req, async (_, ctx) => {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse('INVALID_BODY', 'Request body required', 400);

    const { status } = body;
    if (!status) return errorResponse('MISSING_FIELD', 'status required', 400);

    try {
      const result = await submitTaskAssignmentResponse(ctx.tenantId, ctx.memberId, id, status);
      return NextResponse.json({ data: result }, { status: 200 });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'NOT_FOUND') return errorResponse('NOT_FOUND', (err as Error).message, 404);
      if (code === 'FORBIDDEN_SCOPE') return errorResponse('FORBIDDEN_SCOPE', (err as Error).message, 403);
      if (code === 'VALIDATION_ERROR') return errorResponse('VALIDATION_ERROR', (err as Error).message, 422);
      throw err;
    }
  });
}
