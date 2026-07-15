import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/src/lib/auth/middleware';
import { listMeetingResources } from '@/src/features/events/service';

// GET /api/meeting-resources — DIP-FP-120-web: tenant-scoped list of fixed
// Zoom accounts, for the EventForm "Online Meeting" dropdown. No role
// restriction — any authenticated member can read it.
export async function GET(req: NextRequest) {
  return withAuth(req, async (_, ctx) => {
    const resources = await listMeetingResources(ctx.tenantId);
    return NextResponse.json({ data: resources });
  });
}
