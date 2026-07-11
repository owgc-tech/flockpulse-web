import { NextRequest, NextResponse } from 'next/server';
import { withAuth, errorResponse } from '@/src/lib/auth/middleware';
import { getMyProfile, updateMyProfile } from '@/src/features/members/service';

// GET /api/members/me — FP-112: self-service profile read, including group memberships.
// No role restriction — inherently self-scoped via ctx.memberId, no id param needed.
export async function GET(req: NextRequest) {
  return withAuth(req, async (_, ctx) => {
    try {
      const profile = await getMyProfile(ctx.memberId, ctx.tenantId);
      return NextResponse.json({ data: profile });
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'NOT_FOUND_IN_TENANT') {
        return errorResponse('NOT_FOUND_IN_TENANT', 'Member not found for this tenant', 404);
      }
      throw err;
    }
  });
}

// PATCH /api/members/me — FP-112: self-service profile update. Only firstName/lastName/
// gender/maritalStatus/birthdate are ever accepted — role/email/tenant_id are never read
// from the body, matching the members_update_self RLS policy's documented intent.
export const PATCH = (req: NextRequest) =>
  withAuth(req, async (req, ctx) => {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse('INVALID_BODY', 'Request body required', 400);

    try {
      const profile = await updateMyProfile(ctx.memberId, ctx.tenantId, {
        firstName: body.firstName,
        lastName: body.lastName,
        gender: body.gender,
        maritalStatus: body.maritalStatus,
        birthdate: body.birthdate,
      });
      return NextResponse.json({ data: profile });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'NOT_FOUND_IN_TENANT') return errorResponse('NOT_FOUND_IN_TENANT', 'Member not found for this tenant', 404);
      if (code === 'INVALID_VALUE') return errorResponse('INVALID_VALUE', (err as Error).message, 422);
      throw err;
    }
  });
