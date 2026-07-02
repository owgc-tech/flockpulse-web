import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse } from '@/src/lib/auth/middleware';
import { submitConfirmation } from '@/src/features/confirmations/confirmation.service';

// POST /api/confirmations/:selfReportId — FP-23: Leader confirm or reject a member's self-report.
// LEADER (own assigned members) or ADMIN (any member) only.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ selfReportId: string }> }
) {
  const { selfReportId } = await params;

  return withAuth(req, requireRole('LEADER')(async (_, ctx) => {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse('INVALID_BODY', 'Request body required', 400);

    const { decision, leader_note } = body;

    if (!decision) return errorResponse('MISSING_FIELD', 'decision required', 400);
    if (decision !== 'CONFIRM' && decision !== 'REJECT') {
      return errorResponse('INVALID_VALUE', 'decision must be CONFIRM or REJECT', 400);
    }

    try {
      const result = await submitConfirmation(ctx.tenantId, ctx.memberId, ctx.role, selfReportId, {
        decision,
        leaderNote: leader_note,
      });
      return NextResponse.json({ data: result }, { status: 200 });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'NOT_FOUND') return errorResponse('NOT_FOUND', (err as Error).message, 404);
      if (code === 'FORBIDDEN_SCOPE') return errorResponse('FORBIDDEN_SCOPE', (err as Error).message, 403);
      if (code === 'CONFIRMATION_NOT_ALLOWED') return errorResponse('CONFIRMATION_NOT_ALLOWED', (err as Error).message, 422);
      if (code === 'ATTENDANCE_NOT_OPEN') return errorResponse('ATTENDANCE_NOT_OPEN', (err as Error).message, 422);
      throw err;
    }
  }));
}
