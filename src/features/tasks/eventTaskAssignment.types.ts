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
