import { createClient } from '@supabase/supabase-js';
import type {
  EventTaskAssignmentRow,
  AssigneeSelector,
  CreateEventTaskAssignmentInput,
  UpdateEventTaskAssignmentInput,
  MyTaskAssignmentRow,
  TaskResponseStatus,
  OutstandingRefusal,
  EventTaskAssignmentWithRefusals,
} from './eventTaskAssignment.types';
import {
  insertEventTaskAssignment,
  patchEventTaskAssignment,
  getEventTaskAssignment,
  listEventTaskAssignmentsForEvent,
  deleteEventTaskAssignment,
  getTaskById,
  getTaskAssignmentLimit,
  submitTaskAssignmentResponseRpc,
  listCurrentResponsesForMember,
  listCurrentRefusedResponsesForEvent,
  resolveAssigneeMemberIds,
} from './eventTaskAssignment.repository';
import { attachEffectiveStatus, recordEventViewBestEffort } from '@/src/features/events/service';
import { isAdminTier, type Role } from '@/src/lib/auth/middleware';

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

// FP-234: de-duplicates group_ids and member_ids (first occurrence wins, order
// kept) so a repeated id can neither be stored nor trip the row-count comparison.
// null/undefined pass through untouched; keys that were absent stay absent.
function normalizeAssignee(assignee: AssigneeSelector | null | undefined): AssigneeSelector | null | undefined {
  if (!assignee) return assignee;
  const out: AssigneeSelector = { ...assignee };
  if (assignee.group_ids) out.group_ids = [...new Set(assignee.group_ids)];
  if (assignee.member_ids) out.member_ids = [...new Set(assignee.member_ids)];
  return out;
}

// Mirrors validateEventTypeId()/validatePrayerLeaderMemberId() in
// src/features/events/service.ts — same pattern, applied to the assignee
// JSONB's group_ids/member_ids arrays instead of a single FK column.
// groups.deleted_at DOES exist (added by migration 20260713000036,
// FP-70/71) — a prior pass here checked only groups' original CREATE TABLE
// and missed that later ALTER TABLE, wrongly assuming no soft-delete
// column. Corrected: group_ids are checked tenant-scoped AND
// not-soft-deleted, same as member_ids below.
//
// FP-234: takes an already de-duplicated assignee and returns the assignee to
// save. A stale id (deleted/deactivated member, soft-deleted group) that is
// ALREADY STORED on the assignment is silently dropped instead of rejecting the
// whole save — it has no chip in the pickers, so the user could never remove it.
// A NEWLY ADDED invalid id is still rejected with the original error. On create
// there are no stored ids, so it stays fully strict.
async function validateAssignee(
  assignee: AssigneeSelector | null | undefined,
  tenantId: string,
  stored?: AssigneeSelector | null
): Promise<AssigneeSelector | null | undefined> {
  if (!assignee) return assignee;
  const groupIds = assignee.group_ids ?? [];
  const memberIds = assignee.member_ids ?? [];
  if (groupIds.length === 0 && memberIds.length === 0) return assignee;

  const client = serviceClient();
  const result: AssigneeSelector = { ...assignee };

  if (groupIds.length > 0) {
    const { data, error } = await client
      .from('groups')
      .select('id')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .in('id', groupIds);
    if (error) throw error;
    const active = new Set((data ?? []).map((g: { id: string }) => g.id));
    const storedGroups = new Set(stored?.group_ids ?? []);
    const invalid = groupIds.filter((id) => !active.has(id));
    if (invalid.some((id) => !storedGroups.has(id))) {
      throw err('VALIDATION_ERROR', 'assignee.group_ids contains a group that is invalid, soft-deleted, or belongs to a different tenant');
    }
    if (invalid.length > 0) result.group_ids = groupIds.filter((id) => active.has(id));
  }

  if (memberIds.length > 0) {
    const { data, error } = await client
      .from('members')
      .select('id')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .in('id', memberIds);
    if (error) throw error;
    const active = new Set((data ?? []).map((m: { id: string }) => m.id));
    const storedMembers = new Set(stored?.member_ids ?? []);
    const invalid = memberIds.filter((id) => !active.has(id));
    if (invalid.some((id) => !storedMembers.has(id))) {
      throw err('VALIDATION_ERROR', 'assignee.member_ids contains a member that is invalid, soft-deleted, or belongs to a different tenant');
    }
    if (invalid.length > 0) result.member_ids = memberIds.filter((id) => active.has(id));
  }

  return result;
}

// FP-220 / FP-220-adj-1: server-side enforcement of the assignee rules — the
// pickers are convenience only. Two independent checks:
//   1. tenants.task_assignment_limit caps the combined group + member count for
//      EVERY task (individual_only included — it changes what can be assigned,
//      not whether the count limit applies).
//   2. individual_only tasks can never have groups, whatever the client sent.
async function validateAssigneeLimit(
  assignee: AssigneeSelector | null | undefined, taskId: string, tenantId: string
): Promise<void> {
  if (!assignee) return;
  const count = (assignee.group_ids?.length ?? 0) + (assignee.member_ids?.length ?? 0);
  if (count === 0) return;

  const [task, limit] = await Promise.all([getTaskById(tenantId, taskId), getTaskAssignmentLimit(tenantId)]);
  if (count > limit) {
    throw err('VALIDATION_ERROR', `A task can be assigned to at most ${limit} groups/individuals combined`);
  }
  if (task.individual_only && (assignee.group_ids?.length ?? 0) > 0) {
    throw err('VALIDATION_ERROR', 'This task can only be assigned to individuals, not groups');
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

// DIP-FP-190-web: maps block_task_assignment_if_member_unavailable()'s P0001
// guard to MEMBER_UNAVAILABLE, with the member's name parsed out of the
// trigger's own message and attached structurally — same
// assignedMemberCount/ownedGroupCount convention used elsewhere in this
// codebase for attaching structured detail to a thrown error, applied here
// to a name instead of a count. This substring and the trigger's own RAISE
// EXCEPTION text (20260811000070) must always change together.
function mapUnavailabilityError(error: unknown): never {
  const e = error as { code?: string; message?: string };
  if (e.code === 'P0001' && e.message?.includes('marked unavailable on this date')) {
    const mapped = new Error(e.message) as Error & { code: string; memberName?: string };
    mapped.code = 'MEMBER_UNAVAILABLE';
    const match = e.message.match(/^Cannot assign ([^:]+):/);
    if (match) mapped.memberName = match[1];
    throw mapped;
  }
  throw error;
}

// FP-222: actorMemberId (optional, trailing) — the member who made the write. After a
// successful write the version has been bumped, so the actor's own view is recorded at
// the new version (best-effort) and they never see their own change as "modified".
export async function createTaskAssignment(
  tenantId: string, input: CreateEventTaskAssignmentInput, actorMemberId?: string
): Promise<EventTaskAssignmentRow> {
  if (!input.eventId) throw err('VALIDATION_ERROR', 'eventId is required');
  if (!input.taskId) throw err('VALIDATION_ERROR', 'taskId is required');

  await validateEventId(input.eventId, tenantId);
  await validateTaskId(input.taskId, tenantId);
  // FP-234: de-duplicated, then strictly validated (create has no stored ids).
  const assignee = await validateAssignee(normalizeAssignee(input.assignee), tenantId);
  await validateAssigneeLimit(assignee, input.taskId, tenantId);

  let created: EventTaskAssignmentRow;
  try {
    created = await insertEventTaskAssignment(tenantId, { ...input, assignee });
  } catch (error: unknown) {
    mapUnavailabilityError(error);
  }
  await recordEventViewBestEffort(tenantId, actorMemberId, created.event_id);
  return created;
}

export async function updateTaskAssignment(
  id: string, tenantId: string, input: UpdateEventTaskAssignmentInput, actorMemberId?: string
): Promise<EventTaskAssignmentRow> {
  const existing = await getEventTaskAssignment(id, tenantId);
  if (!existing) throw err('NOT_FOUND', 'Event task assignment not found');

  // FP-234: de-duplicate, then drop ids that are stored-but-no-longer-active; the
  // FP-220 limit / individual_only checks run on this final, normalized list.
  const assignee = await validateAssignee(normalizeAssignee(input.assignee), tenantId, existing.assignee);
  await validateAssigneeLimit(assignee, existing.task_id, tenantId);

  let updated: EventTaskAssignmentRow | null;
  try {
    updated = await patchEventTaskAssignment(id, tenantId, assignee === undefined ? {} : { assignee });
  } catch (error: unknown) {
    mapUnavailabilityError(error);
  }
  if (!updated) throw err('NOT_FOUND', 'Event task assignment not found');
  // FP-222: only when the write really changed something — update_task_assignment returns
  // the row untouched (same updated_at, no version bump) for an identical assignee, and a
  // no-op must not clear the actor's own "modified" state.
  if (updated.updated_at !== existing.updated_at) {
    await recordEventViewBestEffort(tenantId, actorMemberId, updated.event_id);
  }
  return updated;
}

export async function deleteTaskAssignment(id: string, tenantId: string, actorMemberId?: string): Promise<void> {
  const existing = await getEventTaskAssignment(id, tenantId);
  if (!existing) throw err('NOT_FOUND', 'Event task assignment not found');
  const deleted = await deleteEventTaskAssignment(id, tenantId);
  if (deleted) await recordEventViewBestEffort(tenantId, actorMemberId, existing.event_id);
}

// FP-221: a member commits to or refuses a task assignment. tenantId and
// memberId come from the JWT context only. The SQL function does the checks in
// one transaction; its custom SQLSTATEs map to canonical codes here.
//
// Error-code note: Engineering Spec section 6 has no code purpose-built for
// "event not open for task responses" (ATTENDANCE_NOT_OPEN is attendance-specific
// and misleading here, INVALID_STATE is documented as non-canonical), so this
// uses the generic canonical VALIDATION_ERROR rather than inventing a new code.
export async function submitTaskAssignmentResponse(
  tenantId: string, memberId: string, assignmentId: string, status: TaskResponseStatus
): Promise<{ assignment_id: string; status: TaskResponseStatus; responded_at: string }> {
  if (status !== 'COMMITTED' && status !== 'REFUSED') {
    throw err('VALIDATION_ERROR', "status must be 'COMMITTED' or 'REFUSED'");
  }

  try {
    const row = await submitTaskAssignmentResponseRpc(tenantId, assignmentId, memberId, status);
    return { assignment_id: assignmentId, status: row.status, responded_at: row.responded_at };
  } catch (error: unknown) {
    const e = error as { code?: string; message?: string };
    if (e.code === 'FP404') throw err('NOT_FOUND', 'Event task assignment not found');
    if (e.code === 'FP403') throw err('FORBIDDEN_SCOPE', 'You are not assigned to this task');
    if (e.code === 'FP409') throw err('VALIDATION_ERROR', 'Responses are only accepted while the event is scheduled or active');
    if (e.code === 'FP422') throw err('VALIDATION_ERROR', "status must be 'COMMITTED' or 'REFUSED'");
    throw error;
  }
}

// FP-221: current REFUSED responses on an event whose member still resolves as an
// assignee (a refusal by someone since removed from a group, say, is hidden even
// before anything clears it), with member names. Resolution goes through
// resolve_assignee_member_ids — one call per assignment that actually has a
// refusal, not per assignment on the event.
export async function listOutstandingRefusalsForEvent(
  tenantId: string, eventId: string
): Promise<OutstandingRefusal[]> {
  const refused = await listCurrentRefusedResponsesForEvent(tenantId, eventId);
  if (refused.length === 0) return [];

  const assignments = await listEventTaskAssignmentsForEvent(eventId, tenantId);
  const assigneeById = new Map(assignments.map((a) => [a.id, a.assignee]));

  const assignmentIds = [...new Set(refused.map((r) => r.assignment_id))];
  const resolvedByAssignment = new Map<string, Set<string>>();
  await Promise.all(assignmentIds.map(async (id) => {
    const memberIds = await resolveAssigneeMemberIds(tenantId, assigneeById.get(id) ?? null);
    resolvedByAssignment.set(id, new Set(memberIds));
  }));

  return refused
    .filter((r) => resolvedByAssignment.get(r.assignment_id)?.has(r.member_id))
    .map((r) => ({
      assignment_id: r.assignment_id,
      task_id: r.task_id,
      member_id: r.member_id,
      member_name: `${r.first_name} ${r.last_name}`.trim(),
      responded_at: r.responded_at,
    }));
}

export async function listTaskAssignmentsForEvent(
  eventId: string, tenantId: string
): Promise<EventTaskAssignmentRow[]> {
  return await listEventTaskAssignmentsForEvent(eventId, tenantId);
}

// FP-222-adj-1: the event's task assignments plus WHO refused, for the mobile detail
// screen (same data the web event page shows as "Refused: Name"). refused_by is filled
// ONLY when the caller may manage the event — the exact rule app/admin/(shell)/events/[id]/
// page.tsx uses for canManage: Admin tier, or the event's owner (events.owner_member_id).
// For everyone else (another Leader, a plain member, the refuser) every row carries an
// empty array, and the refusals are not even read.
export async function listTaskAssignmentsForEventWithRefusals(
  eventId: string, tenantId: string, caller: { memberId: string; role: Role }
): Promise<EventTaskAssignmentWithRefusals[]> {
  const rows = await listEventTaskAssignmentsForEvent(eventId, tenantId);
  const empty = rows.map((r) => ({ ...r, refused_by: [] }));
  if (rows.length === 0) return empty;

  let canManage = isAdminTier(caller.role);
  if (!canManage) {
    const { data: event, error } = await serviceClient()
      .from('events')
      .select('owner_member_id')
      .eq('id', eventId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw error;
    canManage = !!event && event.owner_member_id === caller.memberId;
  }
  if (!canManage) return empty;

  const refusals = await listOutstandingRefusalsForEvent(tenantId, eventId);
  const byAssignment = new Map<string, { member_id: string; name: string }[]>();
  for (const r of refusals) {
    if (!byAssignment.has(r.assignment_id)) byAssignment.set(r.assignment_id, []);
    byAssignment.get(r.assignment_id)!.push({ member_id: r.member_id, name: r.member_name });
  }
  return rows.map((r) => ({ ...r, refused_by: byAssignment.get(r.id) ?? [] }));
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

  // FP-221: the caller's current response per assignment — one query for all rows.
  const responses = await listCurrentResponsesForMember(tenantId, memberId, mine.map((a) => a.id));
  const responseByAssignment = new Map(responses.map((r) => [r.assignment_id, r.status]));

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
        my_response: responseByAssignment.get(a.id) ?? null,
      };
    })
    .filter((row): row is MyTaskAssignmentRow => row !== null)
    .sort((a, b) => a.start_datetime.localeCompare(b.start_datetime));
}
