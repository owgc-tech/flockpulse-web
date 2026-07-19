import { createClient } from '@supabase/supabase-js';
import type {
  EventTaskAssignmentRow,
  CreateEventTaskAssignmentInput,
  UpdateEventTaskAssignmentInput,
} from './eventTaskAssignment.types';

const COLS = 'id, tenant_id, event_id, task_id, assignee, created_at, updated_at';

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function insertEventTaskAssignment(
  tenantId: string, input: CreateEventTaskAssignmentInput
): Promise<EventTaskAssignmentRow> {
  const { data, error } = await serviceClient()
    .from('event_tasks_assignments')
    .insert({
      tenant_id: tenantId,
      event_id: input.eventId,
      task_id: input.taskId,
      assignee: input.assignee ?? null,
    })
    .select(COLS)
    .single();

  if (error) throw error;
  return data as EventTaskAssignmentRow;
}

export async function patchEventTaskAssignment(
  id: string, tenantId: string, input: UpdateEventTaskAssignmentInput
): Promise<EventTaskAssignmentRow | null> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.assignee !== undefined) patch.assignee = input.assignee;

  const { data, error } = await serviceClient()
    .from('event_tasks_assignments')
    .update(patch)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select(COLS)
    .single();

  if (error) throw error;
  return data as EventTaskAssignmentRow;
}

export async function getEventTaskAssignment(id: string, tenantId: string): Promise<EventTaskAssignmentRow | null> {
  const { data, error } = await serviceClient()
    .from('event_tasks_assignments')
    .select(COLS)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .single();

  if (error) return null;
  return data as EventTaskAssignmentRow;
}

export async function listEventTaskAssignmentsForEvent(
  eventId: string, tenantId: string
): Promise<EventTaskAssignmentRow[]> {
  const { data, error } = await serviceClient()
    .from('event_tasks_assignments')
    .select(COLS)
    .eq('event_id', eventId)
    .eq('tenant_id', tenantId);

  if (error) throw error;
  return (data ?? []) as EventTaskAssignmentRow[];
}

export async function deleteEventTaskAssignment(id: string, tenantId: string): Promise<boolean> {
  const { error, count } = await serviceClient()
    .from('event_tasks_assignments')
    .delete({ count: 'exact' })
    .eq('id', id)
    .eq('tenant_id', tenantId);

  if (error) throw error;
  return (count ?? 0) > 0;
}
