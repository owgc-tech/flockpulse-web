import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse } from '@/src/lib/auth/middleware';
import { listPendingConfirmations } from '@/src/features/confirmations/confirmation.service';

// GET /api/confirmations/pending — FP-26: View self-report context for confirmation.
// LEADER sees only their assigned members; ADMIN sees all tenant members.
export async function GET(req: NextRequest) {
  return withAuth(req, requireRole('LEADER')(async (_, ctx) => {
    try {
      const items = await listPendingConfirmations(ctx.tenantId, ctx.memberId, ctx.role);
      return NextResponse.json({ data: items });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'NOT_FOUND') return errorResponse('NOT_FOUND', (err as Error).message, 404);
      throw err;
    }
  }));
}
