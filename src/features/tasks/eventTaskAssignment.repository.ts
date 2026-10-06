import { createClient } from '@supabase/supabase-js';
import type {
  EventTaskAssignmentRow,
  CreateEventTaskAssignmentInput,
  UpdateEventTaskAssignmentInput,
  RosterEntry,
  TaskAutoAssignSlotRow,
  TaskAssignmentResponseRow,
  TaskResponseStatus,
  AssigneeStateEntry,
} from './eventTaskAssignment.types';

const COLS = 'id, tenant_id, event_id, task_id, assignee, created_at, updated_at';

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// FP-221: create/update/delete go through atomic SECURITY DEFINER functions
// (20261003000074) that do the original write plus the events.version bump and
// response clearing in one transaction — never a separate client call after.
export async function insertEventTaskAssignment(
  tenantId: string, input: CreateEventTaskAssignmentInput
): Promise<EventTaskAssignmentRow> {
  const { data, error } = await serviceClient().rpc('create_task_assignment', {
    p_tenant_id: tenantId,
    p_event_id: input.eventId,
    p_task_id: input.taskId,
    p_assignee: input.assignee ?? null,
  });

  if (error) throw error;
  return data as EventTaskAssignmentRow;
}

export async function patchEventTaskAssignment(
  id: string, tenantId: string, input: UpdateEventTaskAssignmentInput
): Promise<EventTaskAssignmentRow | null> {
  const { data, error } = await serviceClient().rpc('update_task_assignment', {
    p_tenant_id: tenantId,
    p_id: id,
    p_assignee: input.assignee ?? null,
    p_assignee_provided: input.assignee !== undefined,
  });

  if (error) {
    if (error.code === 'FP404') return null;
    throw error;
  }
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
  const { data, error } = await serviceClient().rpc('delete_task_assignment', {
    p_tenant_id: tenantId,
    p_id: id,
  });

  if (error) throw error;
  return data === true;
}

// FP-221: submits (or changes) a member's Commit/Refuse. The function enforces
// event-open, active member and assignee membership itself; its custom SQLSTATEs
// (FP404/FP403/FP409/FP422) surface as error.code for the service to map.
export async function submitTaskAssignmentResponseRpc(
  tenantId: string, assignmentId: string, memberId: string, status: TaskResponseStatus
): Promise<TaskAssignmentResponseRow> {
  const { data, error } = await serviceClient().rpc('submit_task_assignment_response', {
    p_tenant_id: tenantId,
    p_assignment_id: assignmentId,
    p_member_id: memberId,
    p_status: status,
  });
  if (error) throw error;
  return data as TaskAssignmentResponseRow;
}

// FP-221: ONE query for every current response a member has — listMyTaskAssignments
// joins these to its rows in JS rather than querying per row.
export async function listCurrentResponsesForMember(
  tenantId: string, memberId: string, assignmentIds: string[]
): Promise<{ assignment_id: string; status: TaskResponseStatus }[]> {
  if (assignmentIds.length === 0) return [];
  const { data, error } = await serviceClient()
    .from('event_task_assignment_responses')
    .select('assignment_id, status')
    .eq('tenant_id', tenantId)
    .eq('member_id', memberId)
    .eq('is_current', true)
    .in('assignment_id', assignmentIds);
  if (error) throw error;
  return (data ?? []) as { assignment_id: string; status: TaskResponseStatus }[];
}

// FP-242: every resolved assignee of every task assignment on an event, with their
// current response, in ONE call (list_event_task_assignee_states returns one JSONB array
// so a large group never hits PostgREST's row limit).
export async function listAssigneeStatesForEvent(
  tenantId: string, eventId: string
): Promise<(AssigneeStateEntry & { assignment_id: string })[]> {
  const { data, error } = await serviceClient().rpc('list_event_task_assignee_states', {
    p_tenant_id: tenantId,
    p_event_id: eventId,
  });
  if (error) throw error;
  return (data ?? []) as (AssigneeStateEntry & { assignment_id: string })[];
}

// FP-221: resolves an assignee JSONB to member ids via resolve_assignee_member_ids
// (same rule as listMyTaskAssignments — see the comment there).
export async function resolveAssigneeMemberIds(
  tenantId: string, assignee: unknown
): Promise<string[]> {
  const { data, error } = await serviceClient().rpc('resolve_assignee_member_ids', {
    p_tenant_id: tenantId,
    p_assignee: assignee ?? null,
  });
  if (error) throw error;
  return ((data ?? []) as { member_id: string }[]).map((r) => r.member_id);
}

// DIP-FP-180-adj-6: tenant-scoped-and-active task lookup backing the generic
// auto-assign screen's task dropdown — replaces the old name-keyed
// getTaskByName now that the client supplies a real task_id instead of the
// route resolving one of two hardcoded task names. Also returns name (needed
// for display now that there's no longer a hardcoded label) alongside
// individual_only (the live source of truth for the roster picker's
// individuals-vs-groups behavior).
export async function getTaskById(tenantId: string, taskId: string): Promise<{ id: string; name: string; individual_only: boolean }> {
  const { data, error } = await serviceClient()
    .from('tasks')
    .select('id, name, individual_only')
    .eq('tenant_id', tenantId)
    .eq('id', taskId)
    .is('deleted_at', null)
    .single();

  if (error || !data) {
    const err = new Error(`Task ${taskId} not found for this tenant`) as Error & { code: string };
    err.code = 'NOT_FOUND';
    throw err;
  }
  return data as { id: string; name: string; individual_only: boolean };
}

// FP-220: tenants.task_assignment_limit — the cap on combined groups +
// individuals assigned to a non-individual_only task.
export async function getTaskAssignmentLimit(tenantId: string): Promise<number> {
  const { data, error } = await serviceClient()
    .from('tenants')
    .select('task_assignment_limit')
    .eq('id', tenantId)
    .single();
  if (error) throw error;
  return data.task_assignment_limit as number;
}

// DIP-FP-180-adj-5: every upcoming (DRAFT/SCHEDULED/ACTIVE) event whose
// event_type_id is in eventTypeIds AND whose end_datetime hasn't passed yet
// is an open slot for this task, whether or not event_tasks_assignments has
// a row for it yet (EventForm.tsx's syncTaskAssignments never creates one
// for an unassigned task). The end_datetime check exists because DRAFT is a
// sticky status (get_event_effective_status never ages a DRAFT event out on
// its own) — without it, a stale past-dated draft would stay eligible
// forever. Checked against end_datetime, not start_datetime, so an
// in-progress ACTIVE event (past start_datetime by definition) stays
// eligible. An empty eventTypeIds short-circuits to [] with no query at all
// — every event type starts unchecked on the auto-assign screens, so this
// is the actual default state, not an edge case. Driven by events first,
// then this task's existing rows are overlaid on top in JS — a LEFT JOIN
// done in application code, matching the established fetch-and-reduce
// convention (getEligibleAttendanceRows). Events with no row surface with
// id: null, assignee: null.
export async function listSlotsForTaskUpcoming(
  tenantId: string, taskId: string, eventTypeIds: string[]
): Promise<TaskAutoAssignSlotRow[]> {
  if (eventTypeIds.length === 0) return [];

  const db = serviceClient();

  const { data: eventRows, error: eventError } = await db
    .from('events')
    .select('id, name, start_datetime, end_datetime')
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

  const upcomingEvents = (eventRows as { id: string; name: string; start_datetime: string; end_datetime: string }[])
    .filter((e) => upcomingEventIds.has(e.id) && new Date(e.end_datetime).getTime() >= Date.now());
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
