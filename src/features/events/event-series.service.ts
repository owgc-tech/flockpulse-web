import { createClient } from '@supabase/supabase-js';
import { validateTalkIdForEvent } from '@/src/features/formation/talk.service';
import { validateEventTypeId, cancelEvent } from './service';
import { computeOccurrenceDates } from './event.types';
import type { SeriesFrequency, OccurrenceDates, EventTarget, CancelRemainingResult } from './event.types';

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export interface CreateEventSeriesInput {
  tenantId: string;
  frequency: SeriesFrequency;
  occurrenceDates: OccurrenceDates[]; // precomputed by computeOccurrenceDates() — single-sourced, not recomputed here
  name: string;
  eventTypeId: string;
  locationName: string;
  locationAddress: string;
  locationUrl?: string | null;
  target: EventTarget;
  talkId?: string | null;
  actorMemberId?: string | null;
}

export async function createEventSeries(input: CreateEventSeriesInput) {
  if (input.occurrenceDates.length < 1) {
    const err = new Error('At least one occurrence is required') as Error & { code: string };
    err.code = 'VALIDATION_ERROR';
    throw err;
  }

  // App-layer validation — defense-in-depth on top of DB triggers, same reused checks createEvent() uses.
  await validateEventTypeId(input.eventTypeId, input.tenantId);
  if (input.talkId) {
    await validateTalkIdForEvent(input.talkId, input.tenantId);
  }

  const occurrencePayload = input.occurrenceDates.map(o => ({
    start_datetime: o.start.toISOString(),
    end_datetime: o.end.toISOString(),
  }));

  const { data, error } = await serviceClient().rpc('create_event_series_with_audit', {
    p_tenant_id: input.tenantId,
    p_frequency: input.frequency,
    p_occurrence_dates: occurrencePayload,
    p_name: input.name,
    p_event_type_id: input.eventTypeId,
    p_location_name: input.locationName,
    p_location_address: input.locationAddress,
    p_location_url: input.locationUrl ?? null,
    p_target: input.target,
    p_talk_id: input.talkId ?? null,
    p_actor_member_id: input.actorMemberId ?? null,
  });

  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('exceeds cap') || msg.includes('must be at least 1') || msg.includes('must be WEEKLY')) {
      const err = new Error(msg) as Error & { code: string };
      err.code = 'VALIDATION_ERROR';
      throw err;
    }
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;
  return row as { series_id: string; event_ids: string[] };
}

export interface ConvertEventToSeriesInput {
  eventId: string;
  tenantId: string;
  startDatetime: Date; // the existing event's own current start/end — needed to compute
  endDatetime: Date;   // the full occurrence sequence, index 0 of which is this event itself.
  frequency: SeriesFrequency;
  mode: 'COUNT' | 'UNTIL';
  countOrUntil: number | Date;
  actorMemberId?: string | null;
}

// FP-106: attaches an existing single event to a brand-new series as its first occurrence.
// Reuses computeOccurrenceDates() exactly (DIP Grounding Check) — index 0 of the computed
// sequence is the existing event's own unchanged dates, so only indices 1..N-1 (the new
// siblings) are sent to the RPC. Slicing here, once, is the only place this split happens.
export async function convertEventToSeries(input: ConvertEventToSeriesInput) {
  const fullSequence = computeOccurrenceDates(
    input.startDatetime, input.endDatetime, input.frequency, input.mode, input.countOrUntil
  );
  const additionalOccurrences = fullSequence.slice(1);

  const occurrencePayload = additionalOccurrences.map(o => ({
    start_datetime: o.start.toISOString(),
    end_datetime: o.end.toISOString(),
  }));

  const { data, error } = await serviceClient().rpc('convert_event_to_series_with_audit', {
    p_event_id: input.eventId,
    p_tenant_id: input.tenantId,
    p_frequency: input.frequency,
    p_additional_occurrence_dates: occurrencePayload,
    p_actor_member_id: input.actorMemberId ?? null,
  });

  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('not found for tenant')) {
      const err = new Error('Event not found') as Error & { code: string };
      err.code = 'NOT_FOUND';
      throw err;
    }
    if (msg.includes('already belongs to a series')) {
      const err = new Error(msg) as Error & { code: string };
      err.code = 'VALIDATION_ERROR';
      throw err;
    }
    if (msg.includes('cannot be converted to a series from status')) {
      const err = new Error(msg) as Error & { code: string };
      err.code = 'INVALID_STATE_TRANSITION';
      throw err;
    }
    if (msg.includes('exceeds cap') || msg.includes('must be WEEKLY')) {
      const err = new Error(msg) as Error & { code: string };
      err.code = 'VALIDATION_ERROR';
      throw err;
    }
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;
  return row as { series_id: string; event_ids: string[] };
}

// FP-68: reuses cancelEvent() (FP-65) per row — explicitly not a new bulk-write mechanism.
// A partial failure here leaves no inconsistent state (each cancel is already atomic on its
// own), unlike series creation, so this does not need SECURITY DEFINER/transaction treatment.
export async function cancelRemainingInSeries(
  seriesId: string,
  tenantId: string,
  actorMemberId?: string | null
): Promise<CancelRemainingResult> {
  const db = serviceClient();

  const { data: seriesEvents, error } = await db
    .from('events')
    .select('id')
    .eq('recurrence_series_id', seriesId)
    .eq('tenant_id', tenantId);

  if (error) throw error;
  if (!seriesEvents || seriesEvents.length === 0) {
    const err = new Error('No events found for this series') as Error & { code: string };
    err.code = 'NOT_FOUND';
    throw err;
  }

  let cancelled = 0;
  let skipped = 0;
  const failures: CancelRemainingResult['failures'] = [];

  for (const ev of seriesEvents) {
    // Pre-filter using the same get_event_effective_status() FP-60/FP-65 already rely on —
    // not a new eligibility rule, just reused. Events not yet COMPLETED/LOCKED/CANCELLED are
    // attempted; already-terminal ones are skipped without calling cancelEvent() at all.
    const { data: effectiveStatus, error: statusError } = await db.rpc('get_event_effective_status', {
      p_event_id: ev.id,
    });
    if (statusError) throw statusError;

    if (effectiveStatus === 'CANCELLED' || effectiveStatus === 'COMPLETED' || effectiveStatus === 'LOCKED') {
      skipped++;
      continue;
    }

    try {
      await cancelEvent(ev.id, tenantId, actorMemberId);
      cancelled++;
    } catch (e: unknown) {
      // A race between the pre-filter check and the cancel call (e.g. the attendance window
      // closed in between) surfaces as INVALID_STATE_TRANSITION from cancelEvent() itself —
      // treat that as skipped, not a failure. Anything else is a genuine per-row failure.
      if ((e as { code?: string }).code === 'INVALID_STATE_TRANSITION') {
        skipped++;
      } else {
        failures.push({ event_id: ev.id, message: (e as Error).message });
      }
    }
  }

  return { cancelled, skipped, failures };
}
