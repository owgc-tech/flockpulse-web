import { NextRequest, NextResponse } from 'next/server';
import { withAuth, errorResponse } from '@/src/lib/auth/middleware';
import { assertCallerCanOpenEvent, getEventReminderContext } from '@/src/features/events/service';

// GET /api/events/:id/reminder-context — FP-96: everything a mobile reminder
// notification needs in one call — event details plus, for Formation events,
// resolved course_name/module_name/talk_name (alias-or-name) and talk_description.
// No role restriction, but (FP-239) the caller must be allowed to open this event — the same
// shared rule as GET /api/events/:id: Admin tier, owner, invited, or holding a task on it.
export const GET = (req: NextRequest, { params }: { params: Promise<{ id: string }> }) =>
  withAuth(req, async (_, ctx) => {
    const { id } = await params;
    if (!id) return errorResponse('MISSING_PARAM', 'Event id required', 400);

    try {
      await assertCallerCanOpenEvent(ctx.tenantId, ctx.memberId, ctx.role, id);
      const context = await getEventReminderContext(id, ctx.tenantId);
      return NextResponse.json({ data: context });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'NOT_FOUND') return errorResponse('NOT_FOUND', 'Event not found', 404);
      if (code === 'FORBIDDEN_SCOPE') return errorResponse('FORBIDDEN_SCOPE', (err as Error).message, 403);
      throw err;
    }
  });
