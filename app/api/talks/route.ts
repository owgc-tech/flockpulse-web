import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse } from '@/src/lib/auth/middleware';
import { createTalk, listTalksByModule } from '@/src/features/formation/talk.service';

// GET /api/talks?module_id=... — list active talks for a module
export async function GET(req: NextRequest) {
  return withAuth(req, async (_, ctx) => {
    const moduleId = req.nextUrl.searchParams.get('module_id');
    if (!moduleId) return errorResponse('MISSING_FIELD', 'module_id query param required', 400);
    const talks = await listTalksByModule(moduleId, ctx.tenantId);
    return NextResponse.json({ data: talks }, { status: 200 });
  });
}

// POST /api/talks — create a talk (Admin only)
export async function POST(req: NextRequest) {
  return withAuth(req, requireRole('ADMIN')(async (_, ctx) => {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse('INVALID_BODY', 'Request body required', 400);

    const { module_id, name, sequence_order } = body;
    if (!module_id) return errorResponse('MISSING_FIELD', 'module_id required', 400);
    if (!name) return errorResponse('MISSING_FIELD', 'name required', 400);
    if (sequence_order === undefined) return errorResponse('MISSING_FIELD', 'sequence_order required', 400);

    try {
      const talk = await createTalk(ctx.tenantId, { moduleId: module_id, name, sequenceOrder: sequence_order });
      return NextResponse.json({ data: talk }, { status: 201 });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'VALIDATION_ERROR') return errorResponse('VALIDATION_ERROR', (err as Error).message, 422);
      if (code === 'NOT_FOUND') return errorResponse('NOT_FOUND', (err as Error).message, 404);
      throw err;
    }
  }));
}
