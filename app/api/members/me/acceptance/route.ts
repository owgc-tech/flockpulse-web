import { NextRequest, NextResponse } from 'next/server';
import { withAuth, errorResponse } from '@/src/lib/auth/middleware';
import { getAcceptanceRequired, recordAcceptance } from '@/src/features/legal/acceptance.service';
import { validateAcceptanceBody } from '@/src/features/legal/acceptance.validation';

// FP-254: Terms of Service / Privacy Policy acceptance for the signed-in member.
// Any authenticated role. Self-scoped: member and tenant come from the JWT (ctx), never from the URL or body.

// GET /api/members/me/acceptance -> { data: { required: boolean } }
export const GET = (req: NextRequest) =>
  withAuth(req, async (_, ctx) => {
    const required = await getAcceptanceRequired(ctx.memberId, ctx.tenantId);
    return NextResponse.json({ data: { required } });
  });

// POST /api/members/me/acceptance  body { confirmAdult: true, acceptTerms: true } -> { data: { accepted: true } }
export const POST = (req: NextRequest) =>
  withAuth(req, async (req, ctx) => {
    const body = await req.json().catch(() => null);
    const check = validateAcceptanceBody(body);
    if (!check.ok) return errorResponse('VALIDATION_ERROR', check.message, 422);

    try {
      await recordAcceptance(ctx.memberId, ctx.tenantId, true);
      return NextResponse.json({ data: { accepted: true } });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'VALIDATION_ERROR') return errorResponse('VALIDATION_ERROR', (err as Error).message, 422);
      if (code === 'NOT_FOUND_IN_TENANT') return errorResponse('NOT_FOUND_IN_TENANT', 'Member not found for this tenant', 404);
      throw err;
    }
  });
