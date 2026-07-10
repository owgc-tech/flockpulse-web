import { NextRequest, NextResponse } from 'next/server';
import { withAuth, errorResponse } from '@/src/lib/auth/middleware';
import { getGroupMembers } from '@/src/features/assignments/service';

// GET /api/groups/:id/members — read-only, tenant-scoped, open to all authenticated roles
// (matching the existing read-openness convention for GET /api/groups). Add/remove goes
// through the existing POST/DELETE /api/assignments directly — no new write path, per
// FP-71's AC.
export const GET = (req: NextRequest, { params }: { params: Promise<{ id: string }> }) =>
  withAuth(req, async (_, ctx) => {
    const { id } = await params;
    if (!id) return errorResponse('MISSING_PARAM', 'Group id required', 400);

    const members = await getGroupMembers(id, ctx.tenantId);
    return NextResponse.json({ data: members });
  });
