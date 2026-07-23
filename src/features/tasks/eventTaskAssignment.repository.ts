import { createClient } from '@supabase/supabase-js';
import type {
  EventTaskAssignmentRow,
  CreateEventTaskAssignmentInput,
  UpdateEventTaskAssignmentInput,
  RosterEntry,
  TaskAutoAssignSlotRow,
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

// DIP-FP-180: single-task-by-name lookup backing both auto-assign screens'
// hardcoded server-side task resolution (the client never supplies a task_id).
export async function getTaskByName(tenantId: string, name: string): Promise<{ id: string; individual_only: boolean }> {
  const { data, error } = await serviceClient()
    .from('tasks')
    .select('id, individual_only')
    .eq('tenant_id', tenantId)
    .eq('name', name)
    .is('deleted_at', null)
    .single();

  if (error || !data) {
    const err = new Error(`Task "${name}" not found for this tenant`) as Error & { code: string };
    err.code = 'NOT_FOUND';
    throw err;
  }
  return data as { id: string; individual_only: boolean };
}

// DIP-FP-180-adj-4: every upcoming (DRAFT/SCHEDULED/ACTIVE) event whose
// event_type_id is in eventTypeIds is an open slot for this task, whether or
// not event_tasks_assignments has a row for it yet (EventForm.tsx's
// syncTaskAssignments never creates one for an unassigned task). An empty
// eventTypeIds short-circuits to [] with no query at all — every event type
// starts unchecked on the auto-assign screens, so this is the actual default
// state, not an edge case. Driven by events first, then this task's existing
// rows are overlaid on top in JS — a LEFT JOIN done in application code,
// matching the established fetch-and-reduce convention
// (getEligibleAttendanceRows). Events with no row surface with id: null,
// assignee: null.
export async function listSlotsForTaskUpcoming(
  tenantId: string, taskId: string, eventTypeIds: string[]
): Promise<TaskAutoAssignSlotRow[]> {
  if (eventTypeIds.length === 0) return [];

  const db = serviceClient();

  const { data: eventRows, error: eventError } = await db
    .from('events')
    .select('id, name, start_datetime')
    .eq('tenant_id', tenantId)
    .in('event_type_id', eventTypeIds);
  if (eventError) throw eventError;
  if (!eventRows || eventRows.length === 0) return [];

  const eventIds = eventRows.map((e: { id: string }) => e.id);

  const { data: statusRows, error: statusError } = await db.rpc('get_events_effective_statuses', {
    p_tenant_id: tenantId,
    p_event_ids: eventIds,
  });
  if (statusError) throw statusError;

  const upcomingEventIds = new Set(
    ((statusRows ?? []) as { event_id: string; effective_status: string }[])
      .filter((r) => r.effective_status === 'DRAFT' || r.effective_status === 'SCHEDULED' || r.effective_status === 'ACTIVE')
      .map((r) => r.event_id)
  );

  const upcomingEvents = (eventRows as { id: string; name: string; start_datetime: string }[])
    .filter((e) => upcomingEventIds.has(e.id));
  if (upcomingEvents.length === 0) return [];

  const { data: slotRows, error: slotError } = await db
    .from('event_tasks_assignments')
    .select('id, event_id, assignee')
    .eq('tenant_id', tenantId)
    .eq('task_id', taskId)
    .in('event_id', upcomingEvents.map((e) => e.id));
  if (slotError) throw slotError;

  const slotByEventId = new Map(
    (slotRows ?? []).map((s: { id: string; event_id: string; assignee: TaskAutoAssignSlotRow['assignee'] }) => [s.event_id, s])
  );

  return upcomingEvents
    .map((event) => {
      const slot = slotByEventId.get(event.id);
      return {
        id: slot?.id ?? null,
        event_id: event.id,
        event_name: event.name,
        start_datetime: event.start_datetime,
        assignee: slot?.assignee ?? null,
      };
    })
    .sort((a, b) => a.start_datetime.localeCompare(b.start_datetime) || a.event_id.localeCompare(b.event_id));
}

// DIP-FP-180: invokes the SECURITY DEFINER round-robin fill. Roster is trusted
// pre-validated by the caller (autoAssign.service.ts's validateRoster);
// eventTypeIds is likewise trusted pre-validated by validateEventTypeIds
// (DIP-FP-180-adj-4).
export async function runAutoAssignTaskSlots(
  tenantId: string, taskId: string, roster: RosterEntry[], actorMemberId: string, eventTypeIds: string[]
): Promise<EventTaskAssignmentRow[]> {
  const { data, error } = await serviceClient().rpc('auto_assign_task_slots', {
    p_tenant_id: tenantId,
    p_task_id: taskId,
    p_roster: roster,
    p_actor_member_id: actorMemberId,
    p_event_type_ids: eventTypeIds,
  });
  if (error) throw error;
  return (data ?? []) as EventTaskAssignmentRow[];
}
