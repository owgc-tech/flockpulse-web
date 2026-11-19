import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse } from '@/src/lib/auth/middleware';
import { createCourse, listCourses } from '@/src/features/formation/course.service';

// GET /api/courses — list active courses for the tenant (any authenticated member)
export async function GET(req: NextRequest) {
  return withAuth(req, async (_, ctx) => {
    const courses = await listCourses(ctx.tenantId);
    return NextResponse.json({ data: courses }, { status: 200 });
  });
}

// POST /api/courses — create a course (Admin only)
export async function POST(req: NextRequest) {
  return withAuth(req, requireRole('ADMIN')(async (_, ctx) => {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse('INVALID_BODY', 'Request body required', 400);

    const { name, sequence_order } = body;
    if (!name) return errorResponse('MISSING_FIELD', 'name required', 400);
    if (sequence_order === undefined) return errorResponse('MISSING_FIELD', 'sequence_order required', 400);

    try {
      const course = await createCourse(ctx.tenantId, { name, sequenceOrder: sequence_order });
      return NextResponse.json({ data: course }, { status: 201 });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'VALIDATION_ERROR') return errorResponse('VALIDATION_ERROR', (err as Error).message, 422);
      throw err;
    }
  }));
}
