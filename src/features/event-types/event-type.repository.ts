import { createClient } from '@supabase/supabase-js';
import type { EventTypeRow, CreateEventTypeInput, UpdateEventTypeInput } from './event-type.types';

const COLS = 'id, tenant_id, name, code, deleted_at, created_at, updated_at';

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function insertEventType(tenantId: string, input: CreateEventTypeInput): Promise<EventTypeRow> {
  const { data, error } = await serviceClient()
    .from('event_types')
    .insert({
      tenant_id: tenantId,
      name: input.name,
      code: input.code,
    })
    .select(COLS)
    .single();

  if (error) throw error;
  return data as EventTypeRow;
}

export async function patchEventType(
  id: string, tenantId: string, input: UpdateEventTypeInput
): Promise<EventTypeRow | null> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.code !== undefined) patch.code = input.code;
  if (input.deletedAt !== undefined) patch.deleted_at = input.deletedAt;

  const { data, error } = await serviceClient()
    .from('event_types')
    .update(patch)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select(COLS)
    .single();

  if (error) throw error;
  return data as EventTypeRow;
}

export async function getEventType(id: string, tenantId: string): Promise<EventTypeRow | null> {
  const { data, error } = await serviceClient()
    .from('event_types')
    .select(COLS)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .single();

  if (error) return null;
  return data as EventTypeRow;
}

export async function listEventTypes(tenantId: string, includeDeleted = false): Promise<EventTypeRow[]> {
  let q = serviceClient()
    .from('event_types')
    .select(COLS)
    .eq('tenant_id', tenantId)
    .order('name', { ascending: true });

  if (!includeDeleted) q = (q as any).is('deleted_at', null);

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as EventTypeRow[];
}
