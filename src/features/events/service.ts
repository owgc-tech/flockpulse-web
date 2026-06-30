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

export async function listEvents(tenantId: string) {
  const { data, error } = await serviceClient()
    .from('events')
    .select('id, name, status, start_datetime, end_datetime, location_name, target, created_at')
    .eq('tenant_id', tenantId)
    .order('start_datetime', { ascending: true });

  if (error) throw error;
  return data;
}
