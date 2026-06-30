import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse } from '@/src/lib/auth/middleware';
import { listMembers, createMember, updateMember, softDeleteMember } from '@/src/features/members/service';

const requireAdmin = requireRole('ADMIN');

export async function GET(req: NextRequest) {
  return withAuth(req, async (_, ctx) => {
    const members = await listMembers(ctx.tenantId);
    return NextResponse.json({ data: members });
  });
}

export const POST = (req: NextRequest) =>
  withAuth(req, requireAdmin(async (req, ctx) => {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse('INVALID_BODY', 'Request body required', 400);

    const { userId, email, firstName, lastName, role } = body;
    if (!userId || !email || !firstName || !lastName || !role) {
      return errorResponse('MISSING_FIELD', 'userId, email, firstName, lastName, role required', 400);
    }
    if (!['ADMIN', 'LEADER', 'MEMBER'].includes(role)) {
      return errorResponse('INVALID_ROLE', 'role must be ADMIN, LEADER, or MEMBER', 400);
    }

    try {
      const member = await createMember({ tenantId: ctx.tenantId, userId, email, firstName, lastName, role });
      return NextResponse.json({ data: member }, { status: 201 });
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'DUPLICATE_EMAIL') {
        return errorResponse('DUPLICATE_EMAIL', 'Email already active for this tenant', 409);
      }
      throw err;
    }
  }));

export const PATCH = (req: NextRequest) =>
  withAuth(req, requireAdmin(async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return errorResponse('MISSING_PARAM', 'id query param required', 400);

    const body = await req.json().catch(() => null);
    if (!body) return errorResponse('INVALID_BODY', 'Request body required', 400);

    const member = await updateMember(id, ctx.tenantId, {
      firstName: body.firstName,
      lastName: body.lastName,
      email: body.email,
      role: body.role,
    });
    return NextResponse.json({ data: member });
  }));

export const DELETE = (req: NextRequest) =>
  withAuth(req, requireAdmin(async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return errorResponse('MISSING_PARAM', 'id query param required', 400);

    await softDeleteMember(id, ctx.tenantId);
    return NextResponse.json({ data: { id, deleted: true } });
  }));
