import { NextRequest, NextResponse } from 'next/server';
import { withAuth, errorResponse } from '@/src/lib/auth/middleware';
import { getEventReminderContext } from '@/src/features/events/service';

// GET /api/events/:id/reminder-context — FP-96: everything a mobile reminder
// notification needs in one call — event details plus, for Formation events,
// resolved course_name/module_name/talk_name (alias-or-name) and talk_description.
// No role restriction, matching GET /api/events/:id's existing precedent.
export const GET = (req: NextRequest, { params }: { params: Promise<{ id: string }> }) =>
  withAuth(req, async (_, ctx) => {
    const { id } = await params;
    if (!id) return errorResponse('MISSING_PARAM', 'Event id required', 400);

    try {
      const context = await getEventReminderContext(id, ctx.tenantId);
      return NextResponse.json({ data: context });
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'NOT_FOUND') {
        return errorResponse('NOT_FOUND', 'Event not found', 404);
      }
      throw err;
    }
  });
