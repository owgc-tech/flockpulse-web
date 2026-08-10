import { createClient } from '@supabase/supabase-js';
import type { EventTaskAssignmentRow, RosterEntry, TaskAutoAssignSlotRow } from './eventTaskAssignment.types';
import {
  getTaskById,
  listSlotsForTaskUpcoming,
  runAutoAssignTaskSlots,
} from './eventTaskAssignment.repository';

// DIP-FP-190-web: one entry per (event, member) pair the round-robin landed
// on that turns out to conflict with that member's filed unavailability.
// The round-robin itself is exempted from the hard block (see the new
// trigger's SET LOCAL exemption, 20260811000070) — this report is how a
// conflict still surfaces, computed after the fact rather than blocked at
// write time. UI for displaying this is DIP 2 of 2's concern.
export interface AutoAssignConflict {
  event_id: string;
  event_name: string;
  member_id: string;
  member_name: string;
}

export interface RunTaskAutoAssignResult {
  assignments: EventTaskAssignmentRow[];
  conflicts: AutoAssignConflict[];
}

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

// DIP-FP-180-adj-6: shared validation for the generic auto-assign screen.
// individualOnly is now read live from the selected task's tasks.individual_only
// (see runTaskAutoAssign) instead of being route-fixed per hardcoded task name —
// that per-route contract no longer exists once the screen is generic, so the
// live DB flag is the contract now, by design.
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
// any ID is trusted. Unlike getTaskAutoAssignData (which passes an empty
// selection straight through with no validation, since all-unchecked is the
// screen's actual default state), an empty eventTypeIds here is always a
// run-time VALIDATION_ERROR — "Run auto-assign" requires at least one
// checked event type, matching the button's disabled condition client-side.
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

// DIP-FP-180-adj-6: replaces getPrayerLeaderAutoAssignData/
// getFoodAssignmentAutoAssignData now that the screen is task-generic. task
// is returned (with name and individual_only) so the client can render the
// label and roster-picker mode without either being hardcoded per route.
export async function getTaskAutoAssignData(
  tenantId: string, taskId: string, eventTypeIds: string[]
): Promise<{ task: { id: string; name: string; individual_only: boolean }; slots: TaskAutoAssignSlotRow[] }> {
  const task = await getTaskById(tenantId, taskId);
  const slots = await listSlotsForTaskUpcoming(tenantId, task.id, eventTypeIds);
  return { task, slots };
}

// DIP-FP-190-web: cross-references the round-robin's own results against
// member_unavailability_ranges, mirroring getAnnouncementRoster()'s
// fetch-and-reduce convention (fetch broadly, join in JS) rather than a
// new SQL join. RETURNS SETOF event_tasks_assignments already gives every
// touched row's event_id/assignee, so this needs zero changes to the RPC
// itself — everything here runs after it returns.
async function computeUnavailabilityConflicts(
  tenantId: string, assignments: EventTaskAssignmentRow[]
): Promise<AutoAssignConflict[]> {
  const memberIds = [...new Set(assignments.flatMap((a) => a.assignee?.member_ids ?? []))];
  if (memberIds.length === 0) return [];

  const client = serviceClient();
  const eventIds = [...new Set(assignments.map((a) => a.event_id))];

  const [{ data: eventRows, error: eventError }, { data: rangeRows, error: rangeError }, { data: memberRows, error: memberError }] =
    await Promise.all([
      client.from('events').select('id, name, start_datetime, end_datetime').eq('tenant_id', tenantId).in('id', eventIds),
      client.from('member_unavailability_ranges').select('member_id, start_date, end_date').eq('tenant_id', tenantId).in('member_id', memberIds),
      client.from('members').select('id, first_name, last_name').eq('tenant_id', tenantId).in('id', memberIds),
    ]);
  if (eventError) throw eventError;
  if (rangeError) throw rangeError;
  if (memberError) throw memberError;

  const eventById = new Map(
    (eventRows ?? []).map((e: { id: string; name: string; start_datetime: string; end_datetime: string }) => [e.id, e])
  );
  const rangesByMember = new Map<string, { start_date: string; end_date: string }[]>();
  for (const r of (rangeRows ?? []) as { member_id: string; start_date: string; end_date: string }[]) {
    const list = rangesByMember.get(r.member_id) ?? [];
    list.push(r);
    rangesByMember.set(r.member_id, list);
  }
  const memberById = new Map((memberRows ?? []).map((m: { id: string; first_name: string; last_name: string }) => [m.id, m]));

  const conflicts: AutoAssignConflict[] = [];
  for (const a of assignments) {
    const event = eventById.get(a.event_id);
    if (!event) continue;
    const eventStartDate = event.start_datetime.slice(0, 10);
    const eventEndDate = event.end_datetime.slice(0, 10);

    for (const memberId of a.assignee?.member_ids ?? []) {
      const ranges = rangesByMember.get(memberId) ?? [];
      const hasConflict = ranges.some((r) => r.start_date <= eventEndDate && r.end_date >= eventStartDate);
      if (!hasConflict) continue;

      const member = memberById.get(memberId);
      conflicts.push({
        event_id: a.event_id,
        event_name: event.name,
        member_id: memberId,
        member_name: member ? `${member.first_name} ${member.last_name}` : 'Unknown member',
      });
    }
  }
  return conflicts;
}

// DIP-FP-180-adj-6: replaces runPrayerLeaderAutoAssign/runFoodAssignmentAutoAssign.
// individualOnly is read live from the selected task's tasks.individual_only —
// the generic screen has no per-route hardcoded boolean to fall back on.
//
// DIP-FP-190-web: also returns a conflict report — the round-robin itself
// runs completely unmodified (exempted from the new hard-block trigger via
// SET LOCAL inside auto_assign_task_slots()), so a slot that lands on an
// unavailable member still succeeds; this surfaces that after the fact
// instead of silently or as a hard failure.
export async function runTaskAutoAssign(
  tenantId: string, taskId: string, roster: RosterEntry[], actorMemberId: string, eventTypeIds: string[]
): Promise<RunTaskAutoAssignResult> {
  const task = await getTaskById(tenantId, taskId);
  await validateRoster(roster, tenantId, { individualOnly: task.individual_only });
  await validateEventTypeIds(eventTypeIds, tenantId);
  const assignments = await runAutoAssignTaskSlots(tenantId, task.id, roster, actorMemberId, eventTypeIds);
  const conflicts = await computeUnavailabilityConflicts(tenantId, assignments);
  return { assignments, conflicts };
}
