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
