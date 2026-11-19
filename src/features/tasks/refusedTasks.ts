import { createClient } from '@supabase/supabase-js';

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

interface AssigneeJson { group_ids?: string[]; member_ids?: string[] }

// FP-222-adj-1: for a batch of events, the NAMES of the tasks that have at least
// one outstanding refusal — i.e. what the Needs Attention strip and the web list
// marker say ("Food Assignment refused"). Task names only, never people.
//
// "Outstanding" means exactly what events_with_outstanding_refusals() (the
// set-based SQL that decides needs_attention) and the web event page's "Refused:
// Name" line mean: a CURRENT response (is_current) with status REFUSED that is
// still attached to an assignment, whose person STILL resolves as an assignee of
// that assignment. A refusal that was cleared (person replaced, changed their
// mind, removed) is_current = false and is never listed.
//
// The SQL function only returns event ids, and this change may not add a
// migration, so the same resolution is done here — but in a CONSTANT number of
// queries however many events are passed (responses, the assignments' assignee
// JSON, the group memberships involved, the task names; each skipped when there is
// nothing to look up), never per event or per assignment.
//
// KEEP IN SYNC with resolve_assignee_member_ids() (20261003000074) and
// listMyTaskAssignments() in eventTaskAssignment.service.ts: an assignee resolves to
// "member_ids contains the person OR any group_ids the person belongs to", group
// membership = assignments rows with assignment_type 'GROUP' and deleted_at IS NULL
// in the same tenant. A test asserts this helper and the SQL function never disagree.
export async function listRefusedTaskNamesByEvent(
  tenantId: string, eventIds: string[]
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (eventIds.length === 0) return result;
  const db = serviceClient();

  const { data: responses, error: respError } = await db
    .from('event_task_assignment_responses')
    .select('event_id, task_id, member_id, assignment_id')
    .eq('tenant_id', tenantId)
    .in('event_id', eventIds)
    .eq('is_current', true)
    .eq('status', 'REFUSED')
    .not('assignment_id', 'is', null);
  if (respError) throw respError;
  const refusals = (responses ?? []) as { event_id: string; task_id: string; member_id: string; assignment_id: string }[];
  if (refusals.length === 0) return result;

  const assignmentIds = [...new Set(refusals.map((r) => r.assignment_id))];
  const { data: assignments, error: asgError } = await db
    .from('event_tasks_assignments')
    .select('id, assignee')
    .eq('tenant_id', tenantId)
    .in('id', assignmentIds);
  if (asgError) throw asgError;
  const assigneeById = new Map(((assignments ?? []) as { id: string; assignee: AssigneeJson | null }[]).map((a) => [a.id, a.assignee]));

  const groupIds = [...new Set(
    [...assigneeById.values()].flatMap((a) => a?.group_ids ?? [])
  )];
  const refuserIds = [...new Set(refusals.map((r) => r.member_id))];
  const groupMemberships = new Set<string>();   // `${group_id}:${member_id}`
  if (groupIds.length > 0) {
    const { data: memberships, error: memError } = await db
      .from('assignments')
      .select('group_id, member_id')
      .eq('tenant_id', tenantId)
      .eq('assignment_type', 'GROUP')
      .is('deleted_at', null)
      .in('group_id', groupIds)
      .in('member_id', refuserIds);
    if (memError) throw memError;
    for (const m of (memberships ?? []) as { group_id: string; member_id: string }[]) {
      groupMemberships.add(`${m.group_id}:${m.member_id}`);
    }
  }

  const resolves = (r: { member_id: string; assignment_id: string }): boolean => {
    const assignee = assigneeById.get(r.assignment_id);
    if (!assignee) return false;
    if ((assignee.member_ids ?? []).includes(r.member_id)) return true;
    return (assignee.group_ids ?? []).some((g) => groupMemberships.has(`${g}:${r.member_id}`));
  };

  const standing = refusals.filter(resolves);
  if (standing.length === 0) return result;

  const taskIds = [...new Set(standing.map((r) => r.task_id))];
  const { data: tasks, error: taskError } = await db
    .from('tasks')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .in('id', taskIds);
  if (taskError) throw taskError;
  const nameById = new Map(((tasks ?? []) as { id: string; name: string }[]).map((t) => [t.id, t.name]));

  const namesByEvent = new Map<string, Set<string>>();
  for (const r of standing) {
    const name = nameById.get(r.task_id);
    if (!name) continue;
    if (!namesByEvent.has(r.event_id)) namesByEvent.set(r.event_id, new Set());
    namesByEvent.get(r.event_id)!.add(name);
  }
  for (const [eventId, names] of namesByEvent) {
    result.set(eventId, [...names].sort((a, b) => a.localeCompare(b)));
  }
  return result;
}
