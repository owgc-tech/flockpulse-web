import { createClient } from '@supabase/supabase-js';
import type {
  EventTaskAssignmentRow,
  AssigneeSelector,
  CreateEventTaskAssignmentInput,
  UpdateEventTaskAssignmentInput,
  MyTaskAssignmentRow,
} from './eventTaskAssignment.types';
import {
  insertEventTaskAssignment,
  patchEventTaskAssignment,
  getEventTaskAssignment,
  listEventTaskAssignmentsForEvent,
  deleteEventTaskAssignment,
} from './eventTaskAssignment.repository';
import { attachEffectiveStatus } from '@/src/features/events/service';

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function err(code: string, message: string): Error & { code: string } {
  const e = new Error(message) as Error & { code: string };
  e.code = code;
  return e;
}

// Mirrors validateEventTypeId()/validatePrayerLeaderMemberId() in
// src/features/events/service.ts — same pattern, applied to the assignee
// JSONB's group_ids/member_ids arrays instead of a single FK column.
// groups.deleted_at DOES exist (added by migration 20260713000036,
// FP-70/71) — a prior pass here checked only groups' original CREATE TABLE
// and missed that later ALTER TABLE, wrongly assuming no soft-delete
// column. Corrected: group_ids are checked tenant-scoped AND
// not-soft-deleted, same as member_ids below.
async function validateAssignee(assignee: AssigneeSelector | null | undefined, tenantId: string): Promise<void> {
  if (!assignee) return;
  const groupIds = assignee.group_ids ?? [];
  const memberIds = assignee.member_ids ?? [];
  if (groupIds.length === 0 && memberIds.length === 0) return;

  const client = serviceClient();

  if (groupIds.length > 0) {
    const { data, error } = await client
      .from('groups')
      .select('id')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .in('id', groupIds);
    if (error) throw error;
    if ((data ?? []).length !== groupIds.length) {
      throw err('VALIDATION_ERROR', 'assignee.group_ids contains a group that is invalid, soft-deleted, or belongs to a different tenant');
    }
  }

  if (memberIds.length > 0) {
    const { data, error } = await client
      .from('members')
      .select('id')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .in('id', memberIds);
    if (error) throw error;
    if ((data ?? []).length !== memberIds.length) {
      throw err('VALIDATION_ERROR', 'assignee.member_ids contains a member that is invalid, soft-deleted, or belongs to a different tenant');
    }
  }
}

async function validateEventId(eventId: string, tenantId: string): Promise<void> {
  const { data } = await serviceClient()
    .from('events')
    .select('id')
    .eq('id', eventId)
    .eq('tenant_id', tenantId)
    .single();
  if (!data) {
    throw err('VALIDATION_ERROR', `event_id ${eventId} is invalid or belongs to a different tenant`);
  }
}

async function validateTaskId(taskId: string, tenantId: string): Promise<void> {
  const { data } = await serviceClient()
    .from('tasks')
    .select('id, deleted_at')
    .eq('id', taskId)
    .eq('tenant_id', tenantId)
    .single();
  if (!data || data.deleted_at !== null) {
    throw err('VALIDATION_ERROR', `task_id ${taskId} is invalid, soft-deleted, or belongs to a different tenant`);
  }
}

export async function createTaskAssignment(
  tenantId: string, input: CreateEventTaskAssignmentInput
): Promise<EventTaskAssignmentRow> {
  if (!input.eventId) throw err('VALIDATION_ERROR', 'eventId is required');
  if (!input.taskId) throw err('VALIDATION_ERROR', 'taskId is required');

  await validateEventId(input.eventId, tenantId);
  await validateTaskId(input.taskId, tenantId);
  await validateAssignee(input.assignee, tenantId);

  return await insertEventTaskAssignment(tenantId, input);
}

export async function updateTaskAssignment(
  id: string, tenantId: string, input: UpdateEventTaskAssignmentInput
): Promise<EventTaskAssignmentRow> {
  const existing = await getEventTaskAssignment(id, tenantId);
  if (!existing) throw err('NOT_FOUND', 'Event task assignment not found');

  await validateAssignee(input.assignee, tenantId);

  const updated = await patchEventTaskAssignment(id, tenantId, input);
  if (!updated) throw err('NOT_FOUND', 'Event task assignment not found');
  return updated;
}

export async function deleteTaskAssignment(id: string, tenantId: string): Promise<void> {
  const existing = await getEventTaskAssignment(id, tenantId);
  if (!existing) throw err('NOT_FOUND', 'Event task assignment not found');
  await deleteEventTaskAssignment(id, tenantId);
}

export async function listTaskAssignmentsForEvent(
  eventId: string, tenantId: string
): Promise<EventTaskAssignmentRow[]> {
  return await listEventTaskAssignmentsForEvent(eventId, tenantId);
}

// FP-161-5: "My Tasks" — every task assignment that includes the calling member,
// directly or via a group they belong to, on upcoming events. Read-only, no
// accept/decline — reassignment happens elsewhere (Admin/event Owner editing the
// assignment directly), per the DIP's explicit scope.
//
// Grounding correction (confirmed live before writing this, not assumed from the
// DIP text): the DIP's Grounding Check describes group membership as resolved via
// assignments.target_id — that column was dropped by migration
// 20260629000003_remediate_rbac_and_assignments.sql, replaced with typed
// group_id/leader_member_id FK columns (assignments_typed_fk_check enforces
// exactly one is set per assignment_type). The underlying mechanism the DIP
// describes (assignments WHERE assignment_type = 'GROUP' AND member_id = X) is
// otherwise correct — only the column name to read is different: group_id, not
// target_id.
//
// Fetch-and-reduce, not a JSONB containment query, matching the established
// convention (e.g. getRsvpReportSummary) — fetch broadly, filter/join in JS.
export async function listMyTaskAssignments(tenantId: string, memberId: string): Promise<MyTaskAssignmentRow[]> {
  const db = serviceClient();

  const { data: groupAssignments, error: groupError } = await db
    .from('assignments')
    .select('group_id')
    .eq('tenant_id', tenantId)
    .eq('member_id', memberId)
    .eq('assignment_type', 'GROUP')
    .is('deleted_at', null);
  if (groupError) throw groupError;
  const myGroupIds = (groupAssignments ?? []).map((a: { group_id: string }) => a.group_id);

  const { data: assignments, error: assignError } = await db
    .from('event_tasks_assignments')
    .select('id, event_id, task_id, assignee')
    .eq('tenant_id', tenantId);
  if (assignError) throw assignError;

  const mine = (assignments ?? []).filter((a: { assignee: AssigneeSelector | null }) => {
    const groupIds = a.assignee?.group_ids ?? [];
    const memberIds = a.assignee?.member_ids ?? [];
    return memberIds.includes(memberId) || groupIds.some((id: string) => myGroupIds.includes(id));
  }) as { id: string; event_id: string; task_id: string; assignee: AssigneeSelector | null }[];
  if (mine.length === 0) return [];

  const eventIds = [...new Set(mine.map((a) => a.event_id))];
  const taskIds = [...new Set(mine.map((a) => a.task_id))];

  const [{ data: events, error: eventsError }, { data: tasks, error: tasksError }] = await Promise.all([
    db.from('events')
      .select('id, name, start_datetime, end_datetime, location_name')
      .eq('tenant_id', tenantId)
      .in('id', eventIds),
    db.from('tasks')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .in('id', taskIds),
  ]);
  if (eventsError) throw eventsError;
  if (tasksError) throw tasksError;

  // FP-164: "Upcoming" is an allowlist (SCHEDULED/ACTIVE only), not a denylist —
  // the original COMPLETED/LOCKED-only exclusion silently let DRAFT events (never
  // published, no date-based lifecycle of their own) show up in My Tasks forever.
  // Enumerating the few valid inclusion states is more robust than enumerating
  // exclusions, since that's exactly the shape of bug this replaces. Still reuses
  // attachEffectiveStatus rather than reimplementing status derivation.
  const eventsWithStatus = await attachEffectiveStatus(events ?? []);
  const eventById = new Map(eventsWithStatus.map((e) => [e.id, e]));
  const taskById = new Map((tasks ?? []).map((t: { id: string; name: string }) => [t.id, t]));

  return mine
    .map((a) => {
      const event = eventById.get(a.event_id);
      if (!event || !['SCHEDULED', 'ACTIVE'].includes(event.effective_status)) return null;
      const task = taskById.get(a.task_id);
      return {
        id: a.id,
        task_id: a.task_id,
        task_name: task?.name ?? 'Unknown task',
        event_id: a.event_id,
        event_name: event.name,
        start_datetime: event.start_datetime,
        end_datetime: event.end_datetime,
        location_name: event.location_name,
        effective_status: event.effective_status,
      };
    })
    .filter((row): row is MyTaskAssignmentRow => row !== null)
    .sort((a, b) => a.start_datetime.localeCompare(b.start_datetime));
}
