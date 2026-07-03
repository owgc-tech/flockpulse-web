import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse } from '@/src/lib/auth/middleware';
import { getCourseById, updateCourse } from '@/src/features/formation/course.service';

// GET /api/courses/:id
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return withAuth(req, async (_, ctx) => {
    try {
      const course = await getCourseById(id, ctx.tenantId);
      return NextResponse.json({ data: course }, { status: 200 });
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'NOT_FOUND') {
        return errorResponse('NOT_FOUND', (err as Error).message, 404);
      }
      throw err;
    }
  });
}

// PATCH /api/courses/:id — update or soft-delete (Admin only)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return withAuth(req, requireRole('ADMIN')(async (_, ctx) => {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse('INVALID_BODY', 'Request body required', 400);

    const { name, sequence_order, deleted_at } = body;

    try {
      const updated = await updateCourse(id, ctx.tenantId, {
        name,
        sequenceOrder: sequence_order,
        deletedAt: deleted_at,
      });
      return NextResponse.json({ data: updated }, { status: 200 });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'NOT_FOUND') return errorResponse('NOT_FOUND', (err as Error).message, 404);
      if (code === 'VALIDATION_ERROR') return errorResponse('VALIDATION_ERROR', (err as Error).message, 422);
      throw err;
    }
  }));
}
