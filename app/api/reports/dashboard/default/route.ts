import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/src/lib/auth/middleware';
import { getDefaultDashboardEvent } from '@/src/features/reports/report.service';

// GET /api/reports/dashboard/default — resolves the single most recent
// already-held event the caller is allowed to see, across every event type,
// for the mobile Dashboard tab's landing state before any manual selection.
// No year restriction (unlike /events) — "the latest event the user is
// allowed to see," full stop. data: null when nothing is visible yet.
export async function GET(req: NextRequest) {
  return withAuth(req, async (_, ctx) => {
    const defaultEvent = await getDefaultDashboardEvent(ctx.tenantId, ctx.memberId, ctx.role);
    return NextResponse.json({ data: defaultEvent });
  });
}
