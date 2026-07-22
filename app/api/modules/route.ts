import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse } from '@/src/lib/auth/middleware';
import { createModule, listModulesByCourse } from '@/src/features/formation/module.service';

// GET /api/modules?course_id=... — list active modules for a course
export async function GET(req: NextRequest) {
  return withAuth(req, async (_, ctx) => {
    const courseId = req.nextUrl.searchParams.get('course_id');
    if (!courseId) return errorResponse('MISSING_FIELD', 'course_id query param required', 400);
    const modules = await listModulesByCourse(courseId, ctx.tenantId);
    return NextResponse.json({ data: modules }, { status: 200 });
  });
}

// POST /api/modules — create a module (Admin only)
export async function POST(req: NextRequest) {
  return withAuth(req, requireRole('ADMIN')(async (_, ctx) => {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse('INVALID_BODY', 'Request body required', 400);

    const { course_id, name, sequence_order } = body;
    if (!course_id) return errorResponse('MISSING_FIELD', 'course_id required', 400);
    if (!name) return errorResponse('MISSING_FIELD', 'name required', 400);
    if (sequence_order === undefined) return errorResponse('MISSING_FIELD', 'sequence_order required', 400);

    try {
      const courseModule = await createModule(ctx.tenantId, { courseId: course_id, name, sequenceOrder: sequence_order });
      return NextResponse.json({ data: courseModule }, { status: 201 });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'VALIDATION_ERROR') return errorResponse('VALIDATION_ERROR', (err as Error).message, 422);
      if (code === 'NOT_FOUND') return errorResponse('NOT_FOUND', (err as Error).message, 404);
      throw err;
    }
  }));
}
