import { createClient } from '@supabase/supabase-js';
import type { EventTaskAssignmentRow, RosterEntry, TaskAutoAssignSlotRow } from './eventTaskAssignment.types';
import {
  getTaskByName,
  listSlotsForTaskUpcoming,
  runAutoAssignTaskSlots,
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

const PRAYER_LEADER_TASK_NAME = 'Prayer Leader';
const FOOD_ASSIGNMENT_TASK_NAME = 'Food Assignment';

// DIP-FP-180: shared validation for both auto-assign screens. individualOnly is
// route-fixed by the caller (Prayer Leader always passes true, Food Assignment
// always passes false) — never derived from tasks.individual_only, so the UI
// contract can't silently drift if that catalog flag is edited elsewhere.
export async function validateRoster(
  roster: RosterEntry[],
  tenantId: string,
  options: { individualOnly: boolean }
): Promise<void> {
  if (!roster || roster.length === 0) {
    throw err('VALIDATION_ERROR', 'roster must contain at least one entry');
  }

  if (options.individualOnly) {
    const groupEntry = roster.find((r) => r.type === 'group');
    if (groupEntry) {
      throw err('VALIDATION_ERROR', 'roster may only contain individual members for this task');
    }
  }

  const client = serviceClient();
  const groupIds = roster.filter((r) => r.type === 'group').map((r) => r.id);
  const memberIds = roster.filter((r) => r.type === 'member').map((r) => r.id);

  if (groupIds.length > 0) {
    const { data, error } = await client
      .from('groups')
      .select('id')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .in('id', groupIds);
    if (error) throw error;
    if ((data ?? []).length !== new Set(groupIds).size) {
      throw err('VALIDATION_ERROR', 'roster contains a group that is invalid, soft-deleted, or belongs to a different tenant');
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
    if ((data ?? []).length !== new Set(memberIds).size) {
      throw err('VALIDATION_ERROR', 'roster contains a member that is invalid, soft-deleted, or belongs to a different tenant');
    }
  }
}

// DIP-FP-180-adj-4: mirrors eventTaskAssignment.service.ts's validateAssignee
// precedent exactly — tenant-scoped, active (deleted_at IS NULL) check before
// any ID is trusted. Unlike getPrayerLeaderAutoAssignData/
// getFoodAssignmentAutoAssignData (which pass an empty selection straight
// through with no validation, since all-unchecked is the screen's actual
// default state), an empty eventTypeIds here is always a run-time
// VALIDATION_ERROR — "Run auto-assign" requires at least one checked event
// type, matching the button's disabled condition client-side.
export async function validateEventTypeIds(eventTypeIds: string[], tenantId: string): Promise<void> {
  if (!eventTypeIds || eventTypeIds.length === 0) {
    throw err('VALIDATION_ERROR', 'eventTypeIds must contain at least one entry');
  }

  const client = serviceClient();
  const { data, error } = await client
    .from('event_types')
    .select('id')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .in('id', eventTypeIds);
  if (error) throw error;
  if ((data ?? []).length !== new Set(eventTypeIds).size) {
    throw err('VALIDATION_ERROR', 'eventTypeIds contains a type that is invalid, soft-deleted, or belongs to a different tenant');
  }
}

async function getAutoAssignData(
  tenantId: string, taskName: string, eventTypeIds: string[]
): Promise<{ task: { id: string; individual_only: boolean }; slots: TaskAutoAssignSlotRow[] }> {
  const task = await getTaskByName(tenantId, taskName);
  const slots = await listSlotsForTaskUpcoming(tenantId, task.id, eventTypeIds);
  return { task, slots };
}

export async function getPrayerLeaderAutoAssignData(tenantId: string, eventTypeIds: string[]) {
  return getAutoAssignData(tenantId, PRAYER_LEADER_TASK_NAME, eventTypeIds);
}

export async function getFoodAssignmentAutoAssignData(tenantId: string, eventTypeIds: string[]) {
  return getAutoAssignData(tenantId, FOOD_ASSIGNMENT_TASK_NAME, eventTypeIds);
}

export async function runPrayerLeaderAutoAssign(
  tenantId: string, roster: RosterEntry[], actorMemberId: string, eventTypeIds: string[]
): Promise<EventTaskAssignmentRow[]> {
  const task = await getTaskByName(tenantId, PRAYER_LEADER_TASK_NAME);
  await validateRoster(roster, tenantId, { individualOnly: true });
  await validateEventTypeIds(eventTypeIds, tenantId);
  return runAutoAssignTaskSlots(tenantId, task.id, roster, actorMemberId, eventTypeIds);
}

export async function runFoodAssignmentAutoAssign(
  tenantId: string, roster: RosterEntry[], actorMemberId: string, eventTypeIds: string[]
): Promise<EventTaskAssignmentRow[]> {
  const task = await getTaskByName(tenantId, FOOD_ASSIGNMENT_TASK_NAME);
  await validateRoster(roster, tenantId, { individualOnly: false });
  await validateEventTypeIds(eventTypeIds, tenantId);
  return runAutoAssignTaskSlots(tenantId, task.id, roster, actorMemberId, eventTypeIds);
}
