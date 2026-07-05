import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse } from '@/src/lib/auth/middleware';
import { inviteMember } from '@/src/features/invitations/invitation.service';

const requireAdmin = requireRole('ADMIN');

// POST /api/invitations — Admin sends an invite email to a prospective member.
// role and groupId are locked at invite time — never editable by the registrant.
// tenant_id is always derived server-side from the calling Admin's JWT.
export const POST = (req: NextRequest) =>
  withAuth(req, requireAdmin(async (req, ctx) => {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse('INVALID_BODY', 'Request body required', 400);

    const { email, role, groupId } = body;

    if (!email) return errorResponse('MISSING_FIELD', 'email required', 400);
    if (!role) return errorResponse('MISSING_FIELD', 'role required', 400);
    if (!['ADMIN', 'LEADER', 'MEMBER'].includes(role)) {
      return errorResponse('INVALID_VALUE', 'role must be ADMIN, LEADER, or MEMBER', 400);
    }
    if (typeof email !== 'string' || !email.includes('@')) {
      return errorResponse('INVALID_VALUE', 'email must be a valid email address', 400);
    }

    try {
      const invitation = await inviteMember(ctx.tenantId, ctx.memberId, {
        email,
        role,
        groupId: groupId ?? null,
      });
      return NextResponse.json({ data: invitation }, { status: 201 });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'DUPLICATE_INVITE') return errorResponse('DUPLICATE_INVITE', (err as Error).message, 409);
      if (code === 'INVITE_FAILED') return errorResponse('INVITE_FAILED', (err as Error).message, 502);
      if (code === 'METADATA_WRITE_FAILED') return errorResponse('METADATA_WRITE_FAILED', (err as Error).message, 500);
      throw err;
    }
  }));
