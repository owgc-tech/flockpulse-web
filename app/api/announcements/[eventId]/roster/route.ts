import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse, isExactlyLeaderTier } from '@/src/lib/auth/middleware';
import { getAnnouncementAcknowledgementRoster } from '@/src/features/announcements/announcement.service';
import { assertCallerCanOpenEvent } from '@/src/features/events/service';

const requireLeader = requireRole('LEADER');

// GET /api/announcements/:eventId/roster — Admin or Leader. Announcement-scoped
// equivalent of GET /api/events/:id/roster (which is deliberately RSVP-only,
// FP-67 Design Decision) — returns each targeted member's acknowledged_at
// status instead of an rsvp_status, since Announcements never create rsvps rows.
// FP-95-mirrored: Leader callers get a roster scoped to their own assigned
// members; Admin callers get the full roster.
// FP-239: and the caller must be allowed to open the event (the shared rule: Admin tier, owner,
// invited, or holding a task on it) — 403 FORBIDDEN_SCOPE otherwise.
export const GET = (req: NextRequest, { params }: { params: Promise<{ eventId: string }> }) =>
  withAuth(req, requireLeader(async (_, ctx) => {
    const { eventId } = await params;
    if (!eventId) return errorResponse('MISSING_PARAM', 'eventId required', 400);

    try {
      await assertCallerCanOpenEvent(ctx.tenantId, ctx.memberId, ctx.role, eventId);
      const roster = await getAnnouncementAcknowledgementRoster(
        ctx.tenantId,
        eventId,
        isExactlyLeaderTier(ctx.role) ? ctx.memberId : undefined
      );
      return NextResponse.json({ data: roster });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'NOT_FOUND') return errorResponse('NOT_FOUND', 'Event not found', 404);
      if (code === 'FORBIDDEN_SCOPE') return errorResponse('FORBIDDEN_SCOPE', (err as Error).message, 403);
      if (code === 'INVALID_TARGET') return errorResponse('INVALID_TARGET', (err as Error).message, 422);
      throw err;
    }
  }));
