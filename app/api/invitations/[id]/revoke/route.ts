import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse } from '@/src/lib/auth/middleware';
import { revokeInvitation } from '@/src/features/invitations/invitation.service';

const requireAdmin = requireRole('ADMIN');

// POST /api/invitations/[id]/revoke — Admin revokes a PENDING invitation.
// Auth user is deleted before the DB row is updated — see service layer for ordering rationale.
export const POST = (req: NextRequest, { params }: { params: Promise<{ id: string }> }) =>
  withAuth(req, requireAdmin(async (_req, ctx) => {
    const { id } = await params;
    if (!id) return errorResponse('MISSING_PARAM', 'Invitation id required', 400);

    try {
      await revokeInvitation(ctx.tenantId, ctx.memberId, id);
      return NextResponse.json({ data: { id, status: 'REVOKED' } });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'NOT_FOUND') return errorResponse('NOT_FOUND', (err as Error).message, 404);
      if (code === 'NOT_PENDING') return errorResponse('NOT_PENDING', (err as Error).message, 409);
      if (code === 'DELETE_USER_FAILED') return errorResponse('DELETE_USER_FAILED', (err as Error).message, 502);
      return errorResponse('REVOKE_FAILED', (err as Error).message, 500);
    }
  }));
