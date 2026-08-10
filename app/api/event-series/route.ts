import { NextRequest, NextResponse } from 'next/server';
import { withAuth, requireRole, errorResponse } from '@/src/lib/auth/middleware';
import { createEventSeries } from '@/src/features/events/event-series.service';
import { computeOccurrenceDates, SERIES_FREQUENCY_CAPS, type SeriesFrequency } from '@/src/features/events/event.types';

const requireAdmin = requireRole('ADMIN');

// POST /api/event-series — Admin only. actorMemberId is derived server-side from
// ctx.memberId, never client-supplied (same pattern as POST /api/events).
export const POST = (req: NextRequest) =>
  withAuth(req, requireAdmin(async (req, ctx) => {
    const body = await req.json().catch(() => null);
    if (!body) return errorResponse('INVALID_BODY', 'Request body required', 400);

    const {
      eventTypeId, name, startDatetime, endDatetime, locationName, locationAddress,
      target, talkId, frequency, mode, count, untilDate,
    } = body;

    if (!eventTypeId || !name || !startDatetime || !endDatetime || !locationName || !locationAddress || !target) {
      return errorResponse('MISSING_FIELD', 'eventTypeId, name, startDatetime, endDatetime, locationName, locationAddress, target required', 400);
    }
    if (!frequency || !['WEEKLY', 'FORTNIGHTLY', 'MONTHLY'].includes(frequency)) {
      return errorResponse('MISSING_FIELD', 'frequency must be WEEKLY, FORTNIGHTLY, or MONTHLY', 400);
    }
    if (mode !== 'COUNT' && mode !== 'UNTIL') {
      return errorResponse('MISSING_FIELD', 'mode must be COUNT or UNTIL', 400);
    }
    if (mode === 'COUNT' && (!count || count < 1)) {
      return errorResponse('MISSING_FIELD', 'count required and must be at least 1 for mode=COUNT', 400);
    }
    if (mode === 'UNTIL' && !untilDate) {
      return errorResponse('MISSING_FIELD', 'untilDate required for mode=UNTIL', 400);
    }

    // Single-sourced occurrence-date computation (DIP-FP-63-FP-68 Grounding Check) —
    // same function EventForm.tsx uses for its live estimate, computed authoritatively here.
    const occurrenceDates = computeOccurrenceDates(
      new Date(startDatetime),
      new Date(endDatetime),
      frequency as SeriesFrequency,
      mode,
      mode === 'COUNT' ? count : new Date(untilDate)
    );

    const cap = SERIES_FREQUENCY_CAPS[frequency as SeriesFrequency];
    if (occurrenceDates.length > cap) {
      return errorResponse('VALIDATION_ERROR', `occurrence_count ${occurrenceDates.length} exceeds cap ${cap} for frequency ${frequency}`, 422);
    }

    try {
      const result = await createEventSeries({
        tenantId: ctx.tenantId,
        frequency,
        occurrenceDates,
        name,
        eventTypeId,
        locationName,
        locationAddress,
        target,
        talkId,
        actorMemberId: ctx.memberId,
      });
      return NextResponse.json({ data: result }, { status: 201 });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'VALIDATION_ERROR') return errorResponse('VALIDATION_ERROR', (err as Error).message, 422);
      if (code === 'INVALID_TARGET') return errorResponse('INVALID_TARGET', (err as Error).message, 422);
      if (code === 'INVALID_FORMATION_LINK') return errorResponse('INVALID_FORMATION_LINK', (err as Error).message, 422);
      throw err;
    }
  }));
