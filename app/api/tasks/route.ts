import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse } from '@/src/lib/auth/middleware';
import { createTask, listTasks } from '@/src/features/tasks/task.service';

// GET /api/tasks — list active tasks for the tenant (any authenticated member)
export async function GET(req: NextRequest) {
  return withAuth(req, async (_, ctx) => {
    const tasks = await listTasks(ctx.tenantId);
    return NextResponse.json({ data: tasks }, { status: 200 });
  });
}

// POST /api/tasks — create a task (Admin only)
export async function POST(req: NextRequest) {
  return withAuth(req, requireRole('ADMIN')(async (_, ctx) => {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse('INVALID_BODY', 'Request body required', 400);

    const { name, individual_only } = body;
    if (!name) return errorResponse('MISSING_FIELD', 'name required', 400);

    try {
      const task = await createTask(ctx.tenantId, { name, individualOnly: individual_only });
      return NextResponse.json({ data: task }, { status: 201 });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'VALIDATION_ERROR') return errorResponse('VALIDATION_ERROR', (err as Error).message, 422);
      throw err;
    }
  }));
}
