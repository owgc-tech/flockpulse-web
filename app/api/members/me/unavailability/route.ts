import { NextRequest, NextResponse } from 'next/server';
import { withAuth, errorResponse } from '@/src/lib/auth/middleware';
import { listMyUnavailability, createMyUnavailability } from '@/src/features/members/member_unavailability.service';

// GET /api/members/me/unavailability — self-service list, memberId derived
// entirely from ctx (the JWT), matching GET /api/members/me. Any
// authenticated role — this is self-service, not an admin action.
export async function GET(req: NextRequest) {
  return withAuth(req, async (_, ctx) => {
    const ranges = await listMyUnavailability(ctx.memberId, ctx.tenantId);
    return NextResponse.json({ data: ranges });
  });
}

// POST /api/members/me/unavailability — self-service filing. No target-id
// parameter of any kind — member_id/tenant_id are derived entirely from
// ctx, matching DELETE /api/members/me's structurally-self-only pattern.
// DIP-FP-190-web: no web UI for filing (mobile-only) — this route exists
// purely as the API mobile (DIP 2 of 2) consumes.
export const POST = (req: NextRequest) =>
  withAuth(req, async (req, ctx) => {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse('INVALID_BODY', 'Request body required', 400);

    try {
      const range = await createMyUnavailability(ctx.memberId, ctx.tenantId, body.startDate, body.endDate);
      return NextResponse.json({ data: range }, { status: 201 });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'VALIDATION_ERROR') return errorResponse('VALIDATION_ERROR', (err as Error).message, 422);
      throw err;
    }
  });
