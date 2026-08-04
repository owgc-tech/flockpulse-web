import { NextRequest, NextResponse } from 'next/server';
import { withAuth, errorResponse } from '@/src/lib/auth/middleware';
import { acknowledgeAnnouncement } from '@/src/features/announcements/announcement.service';

// POST /api/announcements/:eventId/acknowledge — DIP-FP-191-web: records that this
// member has read/acknowledged an Announcement-type event. Deliberately not a write
// to member_attendance_reports/attendance — announcement_acknowledgements is a wholly
// separate table with no code path to either. Any authenticated member may call this
// for themselves; role is not restricted above MEMBER (mirrors POST /api/self-reports'
// own precedent). Idempotent — repeated taps are harmless.
export const POST = (req: NextRequest, { params }: { params: Promise<{ eventId: string }> }) =>
  withAuth(req, async (_, ctx) => {
    const { eventId } = await params;
    if (!eventId) return errorResponse('MISSING_PARAM', 'eventId required', 400);

    try {
      const ack = await acknowledgeAnnouncement(ctx.tenantId, eventId, ctx.memberId);
      return NextResponse.json({ data: ack }, { status: 201 });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'NOT_FOUND') return errorResponse('NOT_FOUND', (err as Error).message, 404);
      if (code === 'INVALID_TARGET') return errorResponse('INVALID_TARGET', (err as Error).message, 422);
      if (code === 'FORBIDDEN_SCOPE') return errorResponse('FORBIDDEN_SCOPE', (err as Error).message, 403);
      throw err;
    }
  });
