import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse } from '@/src/lib/auth/middleware';
import { getTenantSettings, updateTenantSettings } from '@/src/features/tenant/service';

const requireAdmin = requireRole('ADMIN');

export async function GET(req: NextRequest) {
  return withAuth(req, async (_, ctx) => {
    const settings = await getTenantSettings(ctx.tenantId);
    return NextResponse.json({ data: settings });
  });
}

export const PATCH = (req: NextRequest) =>
  withAuth(req, requireAdmin(async (req, ctx) => {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse('INVALID_BODY', 'Request body required', 400);

    try {
      const settings = await updateTenantSettings(ctx.tenantId, {
        attendanceWindowHours: body.attendanceWindowHours,
      });
      return NextResponse.json({ data: settings });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'INVALID_VALUE') return errorResponse('INVALID_VALUE', (err as Error).message, 422);
      if (code === 'NO_FIELDS') return errorResponse('NO_FIELDS', (err as Error).message, 400);
      throw err;
    }
  }));
