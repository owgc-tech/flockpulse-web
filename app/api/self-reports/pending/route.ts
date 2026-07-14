import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/src/lib/auth/middleware';
import { getPendingSelfReports } from '@/src/features/self-reports/self-report.repository';

// GET /api/self-reports/pending — DIP-FP-119-web: events this member is
// expected at, completed but not yet locked, not cancelled, and not already
// self-reported. Any authenticated member may call this for themselves;
// role is not restricted above MEMBER (mirrors POST /api/self-reports).
export async function GET(req: NextRequest) {
  return withAuth(req, async (_, ctx) => {
    const items = await getPendingSelfReports(ctx.tenantId, ctx.memberId);
    return NextResponse.json({ data: items });
  });
}
