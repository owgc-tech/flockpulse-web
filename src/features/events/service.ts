import { createClient } from '@supabase/supabase-js';

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export interface CreateEventInput {
  tenantId: string;
  eventTypeId: string;
  name: string;
  startDatetime: string;
  endDatetime: string;
  locationName: string;
  target: { group_id: string } | Record<string, unknown>;
}

export async function createEvent(input: CreateEventInput) {
  if (new Date(input.endDatetime) <= new Date(input.startDatetime)) {
    const err = new Error('end_datetime must be after start_datetime') as Error & { code: string };
    err.code = 'INVALID_DATETIME';
    throw err;
  }

  const { data, error } = await serviceClient()
    .from('events')
    .insert({
      tenant_id: input.tenantId,
      event_type_id: input.eventTypeId,
      name: input.name,
      status: 'DRAFT',
      start_datetime: input.startDatetime,
      end_datetime: input.endDatetime,
      location_name: input.locationName,
      target: input.target,
    })
    .select('id, name, status, start_datetime, end_datetime, location_name, target, created_at')
    .single();

  if (error) throw error;
  return data;
}

export async function publishEvent(id: string, tenantId: string) {
  // Fetch current state to validate transition.
  const { data: event, error: fetchError } = await serviceClient()
    .from('events')
    .select('id, status, name, start_datetime, end_datetime, location_name, event_type_id, target')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .single();

  if (fetchError || !event) {
    const err = new Error('Event not found') as Error & { code: string };
    err.code = 'NOT_FOUND';
    throw err;
  }

  if (event.status !== 'DRAFT') {
    const err = new Error(`Cannot publish event with status ${event.status}`) as Error & { code: string };
    err.code = 'INVALID_TRANSITION';
    throw err;
  }

  const requiredFields = ['name', 'start_datetime', 'end_datetime', 'location_name', 'event_type_id'] as const;
  for (const field of requiredFields) {
    if (!event[field]) {
      const err = new Error(`Missing required field: ${field}`) as Error & { code: string };
      err.code = 'MISSING_FIELD';
      throw err;
    }
  }

  if (new Date(event.end_datetime) <= new Date(event.start_datetime)) {
    const err = new Error('end_datetime must be after start_datetime') as Error & { code: string };
    err.code = 'INVALID_DATETIME';
    throw err;
  }

  // Transition to SCHEDULED — triggers handle_event_scheduling() for roster + notifications.
  const { data, error } = await serviceClient()
    .from('events')
    .update({ status: 'SCHEDULED', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select('id, name, status, start_datetime, end_datetime')
    .single();

  if (error) throw error;
  return data;
}

export interface UpdateEventInput {
  name?: string;
  startDatetime?: string;
  endDatetime?: string;
  locationName?: string;
  target?: Record<string, unknown>;
  talkId?: string | null;
}

export async function updateEvent(id: string, tenantId: string, input: UpdateEventInput) {
  const db = serviceClient();

  // Fetch current event state.
  const { data: event, error: fetchError } = await db
    .from('events')
    .select('id, status, version, talk_id, start_datetime, end_datetime, name, location_name, target')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .single();

  if (fetchError || !event) {
    const err = new Error('Event not found') as Error & { code: string };
    err.code = 'NOT_FOUND';
    throw err;
  }

  if (event.status === 'LOCKED' || event.status === 'CANCELLED') {
    const err = new Error(`Cannot update event with status ${event.status}`) as Error & { code: string };
    err.code = 'INVALID_STATE';
    throw err;
  }

  // talk_id is immutable once any notification has been dispatched (status != PENDING).
  if (input.talkId !== undefined && input.talkId !== event.talk_id) {
    const { count, error: notifError } = await db
      .from('event_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', id)
      .neq('status', 'PENDING');

    if (notifError) throw notifError;

    if ((count ?? 0) > 0) {
      const err = new Error('talk_id is immutable after notifications have been dispatched') as Error & { code: string };
      err.code = 'IMMUTABLE_FIELD';
      throw err;
    }
  }

  // Validate datetime ordering if either end is being changed.
  const newStart = input.startDatetime ?? event.start_datetime;
  const newEnd = input.endDatetime ?? event.end_datetime;
  if (new Date(newEnd) <= new Date(newStart)) {
    const err = new Error('end_datetime must be after start_datetime') as Error & { code: string };
    err.code = 'INVALID_DATETIME';
    throw err;
  }

  // Build the update payload.
  const patch: Record<string, unknown> = {
    version: event.version + 1,
    updated_at: new Date().toISOString(),
  };
  if (input.name !== undefined) patch.name = input.name;
  if (input.startDatetime !== undefined) patch.start_datetime = input.startDatetime;
  if (input.endDatetime !== undefined) patch.end_datetime = input.endDatetime;
  if (input.locationName !== undefined) patch.location_name = input.locationName;
  if (input.target !== undefined) patch.target = input.target;
  if (input.talkId !== undefined) patch.talk_id = input.talkId;

  const { data: updated, error: updateError } = await db
    .from('events')
    .update(patch)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select('id, name, status, version, start_datetime, end_datetime, location_name, target, talk_id, updated_at')
    .single();

  if (updateError) throw updateError;

  // Recalculate unsent notification scheduled_for values when timing changes.
  // Each purpose has a fixed offset relative to a reference time; recompute
  // from the new reference rather than preserving the old absolute timestamp.
  const timingChanged = input.startDatetime !== undefined || input.endDatetime !== undefined;
  if (timingChanged) {
    const start = new Date(newStart);
    const end = new Date(newEnd);

    const rescheduleMap: Record<string, Date> = {
      PRE_EVENT_REMINDER:     new Date(start.getTime() - 24 * 60 * 60 * 1000),
      POST_EVENT_SELF_REPORT: new Date(end.getTime()),
      LEADER_CONFIRMATION:    new Date(end.getTime() + 2 * 60 * 60 * 1000),
    };

    const { data: unsent, error: unsentError } = await db
      .from('event_notifications')
      .select('id, purpose')
      .eq('event_id', id)
      .in('status', ['PENDING', 'RETRYING'])
      .in('purpose', ['PRE_EVENT_REMINDER', 'POST_EVENT_SELF_REPORT', 'LEADER_CONFIRMATION']);

    if (unsentError) throw unsentError;

    for (const row of unsent ?? []) {
      const newScheduledFor = rescheduleMap[row.purpose as string];
      if (!newScheduledFor) continue;
      const { error: reschedErr } = await db
        .from('event_notifications')
        .update({ scheduled_for: newScheduledFor.toISOString() })
        .eq('id', row.id);
      if (reschedErr) throw reschedErr;
    }
  }

  // Insert EVENT_UPDATE notification for every expected attendee.
  // scheduled_for = now (immediate; dispatch is handled by a separate worker).
  const { data: attendees, error: attendeesError } = await db
    .from('event_attendees')
    .select('member_id')
    .eq('event_id', id)
    .eq('tenant_id', tenantId);

  if (attendeesError) throw attendeesError;

  if ((attendees ?? []).length > 0) {
    const now = new Date().toISOString();
    const notifRows = (attendees ?? []).map((a: { member_id: string }) => ({
      tenant_id: tenantId,
      event_id: id,
      purpose: 'EVENT_UPDATE',
      scheduled_for: now,
      status: 'PENDING',
    }));

    const { error: notifInsertError } = await db
      .from('event_notifications')
      .insert(notifRows);

    if (notifInsertError) throw notifInsertError;
  }

  return updated;
}

export async function listEvents(tenantId: string) {
  const { data, error } = await serviceClient()
    .from('events')
    .select('id, name, status, start_datetime, end_datetime, location_name, target, created_at')
    .eq('tenant_id', tenantId)
    .order('start_datetime', { ascending: true });

  if (error) throw error;
  return data;
}
