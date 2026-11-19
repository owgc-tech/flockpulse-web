import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse } from '@/src/lib/auth/middleware';
import { listUnavailabilityForAdmin } from '@/src/features/members/member_unavailability.service';

const requireLeader = requireRole('LEADER');

// GET /api/members/unavailability — admin-facing (Leader-tier-or-above),
// distinct from the self-service app/api/members/me/unavailability/*. Lists
// every filed unavailability range in the tenant, optionally filtered by
// memberId and/or a startDate/endDate overlap window (both-or-neither,
// enforced in listUnavailabilityForAdmin).
export const GET = (req: NextRequest) =>
  withAuth(req, requireLeader(async (req, ctx) => {
    const memberId = req.nextUrl.searchParams.get('memberId') ?? undefined;
    const startDate = req.nextUrl.searchParams.get('startDate') ?? undefined;
    const endDate = req.nextUrl.searchParams.get('endDate') ?? undefined;

    try {
      const ranges = await listUnavailabilityForAdmin(ctx.tenantId, { memberId, startDate, endDate });
      return NextResponse.json({ data: ranges });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'VALIDATION_ERROR') return errorResponse('VALIDATION_ERROR', (err as Error).message, 422);
      throw err;
    }
  }));
