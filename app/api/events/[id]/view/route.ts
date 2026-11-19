import { NextRequest, NextResponse } from 'next/server';
import { withAuth, errorResponse } from '@/src/lib/auth/middleware';
import { recordEventViewForCaller } from '@/src/features/events/service';

// POST /api/events/:id/view — FP-222: records that the caller has opened this event, at
// the event's current version (or at body.version, clamped to the current version and
// never lowering a stored one). Drives "Recently Modified": events.version greater than
// the version the caller last saw. Any authenticated member who may see the event (the
// same visibility rule as the event list) — nobody else. Safe to call repeatedly. Tenant
// and member come from the JWT context only.
//
// FP-222-adj-1: answers 200 with the standard envelope { data: { version } } (the version
// this call recorded, after clamping to the event's current version) instead of 204 with
// no body — the mobile app's network helper always parses a JSON envelope and cannot read
// an empty body.
export const POST = (req: NextRequest, { params }: { params: Promise<{ id: string }> }) =>
  withAuth(req, async (_, ctx) => {
    const { id } = await params;
    if (!id) return errorResponse('MISSING_PARAM', 'Event id required', 400);

    // The body is optional: an empty body means "the current version".
    const text = await req.text();
    let version: number | undefined;
    if (text.trim() !== '') {
      let body: unknown;
      try { body = JSON.parse(text); } catch { return errorResponse('INVALID_BODY', 'Body must be JSON', 400); }
      const v = (body as { version?: unknown } | null)?.version;
      if (v !== undefined && v !== null) {
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
          return errorResponse('VALIDATION_ERROR', 'version must be a non-negative integer', 422);
        }
        version = v;
      }
    }

    try {
      const recorded = await recordEventViewForCaller(ctx.tenantId, ctx.memberId, ctx.role, id, version);
      return NextResponse.json({ data: { version: recorded } }, { status: 200 });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'NOT_FOUND') return errorResponse('NOT_FOUND', 'Event not found', 404);
      if (code === 'FORBIDDEN_SCOPE') return errorResponse('FORBIDDEN_SCOPE', (err as Error).message, 403);
      if (code === 'VALIDATION_ERROR') return errorResponse('VALIDATION_ERROR', (err as Error).message, 422);
      throw err;
    }
  });
