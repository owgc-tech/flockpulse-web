import { createClient } from '@supabase/supabase-js';
import type {
  EventTaskAssignmentRow,
  AssigneeSelector,
  CreateEventTaskAssignmentInput,
  UpdateEventTaskAssignmentInput,
} from './eventTaskAssignment.types';
import {
  insertEventTaskAssignment,
  patchEventTaskAssignment,
  getEventTaskAssignment,
  listEventTaskAssignmentsForEvent,
  deleteEventTaskAssignment,
} from './eventTaskAssignment.repository';

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
// groups has no deleted_at column (confirmed live), so group_ids are
// checked tenant-scoped only; member_ids also exclude soft-deleted members.
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
      .in('id', groupIds);
    if (error) throw error;
    if ((data ?? []).length !== groupIds.length) {
      throw err('VALIDATION_ERROR', 'assignee.group_ids contains a group that is invalid or belongs to a different tenant');
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
