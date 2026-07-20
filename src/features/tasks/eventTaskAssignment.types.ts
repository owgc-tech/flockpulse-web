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
