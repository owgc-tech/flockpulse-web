export interface AssigneeSelector {
  group_ids?: string[];
  member_ids?: string[];
}

export interface EventTaskAssignmentRow {
  id: string;
  tenant_id: string;
  event_id: string;
  task_id: string;
  assignee: AssigneeSelector | null;
  created_at: string;
  updated_at: string;
}

// FP-221: per-person response to a task assignment. Stored as permanent
// append-only history in event_task_assignment_responses.
export type TaskResponseStatus = 'COMMITTED' | 'REFUSED';

export interface TaskAssignmentResponseRow {
  id: string;
  tenant_id: string;
  assignment_id: string | null;
  event_id: string | null;
  task_id: string;
  member_id: string;
  status: TaskResponseStatus;
  responded_at: string;
  is_current: boolean;
  cleared_at: string | null;
  cleared_reason: 'SUPERSEDED' | 'REMOVED_FROM_ASSIGNMENT' | 'ASSIGNMENT_DELETED' | null;
  created_at: string;
}

// FP-222-adj-1: one person with an outstanding refusal on an assignment.
export interface RefusedBy {
  member_id: string;
  name: string;
}

// FP-242: one resolved assignee of a task assignment and their CURRENT response
// (PENDING = no current response). via_group_id is null for a person assigned directly (or
// both directly and through a group), otherwise the first listed group they belong to.
export type AssigneeState = 'COMMITTED' | 'REFUSED' | 'PENDING';

export interface AssigneeStateEntry {
  member_id: string;
  name: string;
  state: AssigneeState;
  via_group_id: string | null;
}

// FP-222-adj-1 / FP-242: GET /api/event-tasks-assignments?event_id=X rows. refused_by lists the
// people with a CURRENT outstanding refusal on this assignment (names as on the web event
// page: first and last). assignee_states is one entry per resolved assignee in display order
// (direct members, then each group in assignee.group_ids order; within a section REFUSED,
// PENDING, COMMITTED, then name), at most 100 entries; assignee_states_total is the uncapped
// count. All three are filled ONLY for the event's owner and Admin-tier callers (the web event
// page's canManage rule); [] / [] / 0 for everyone else. refused_by is kept, with the same
// shape, for older phone builds.
export interface EventTaskAssignmentWithRefusals extends EventTaskAssignmentRow {
  refused_by: RefusedBy[];
  assignee_states: AssigneeStateEntry[];
  assignee_states_total: number;
}

export interface CreateEventTaskAssignmentInput {
  eventId: string;
  taskId: string;
  assignee?: AssigneeSelector | null;
}

export interface UpdateEventTaskAssignmentInput {
  assignee?: AssigneeSelector | null;
}

// FP-161-5: "My Tasks" — one row per task assignment that includes the calling
// member (directly via assignee.member_ids, or via a group they belong to),
// scoped to upcoming events only, with task/event display fields already joined.
export interface MyTaskAssignmentRow {
  id: string;
  task_id: string;
  task_name: string;
  event_id: string;
  event_name: string;
  start_datetime: string;
  end_datetime: string;
  location_name: string;
  effective_status: string;
  // FP-221: the caller's own current response (current row only, never history).
  my_response: TaskResponseStatus | null;
}

// DIP-FP-180: roster entry for the Prayer Leader / Food Assignment round-robin
// auto-assign screens — an ordered, hand-picked subset the admin builds fresh
// each visit (never persisted).
export interface RosterEntry {
  type: 'member' | 'group';
  id: string;
}

// DIP-FP-180: one row per open slot for a fixed task on an upcoming event,
// as returned by listSlotsForTaskUpcoming — enough to render the auto-assign
// panel's slot list and derive the roster-scoped summary count table.
//
// DIP-FP-180-adj-1: id is now string | null — an upcoming event with no
// event_tasks_assignments row yet for this task still surfaces here (it's
// an open slot, not an absent one), just with no row to PATCH until one is
// created.
export interface TaskAutoAssignSlotRow {
  id: string | null;
  event_id: string;
  event_name: string;
  start_datetime: string;
  assignee: AssigneeSelector | null;
}
