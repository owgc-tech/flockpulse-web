export interface TaskRow {
  id: string;
  tenant_id: string;
  name: string;
  // FP-163: when true, the assignee picker (GroupMemberChipPicker's individualOnly
  // prop) excludes groups from this task's results entirely — individuals only.
  individual_only: boolean;
  // FP-261: when true, the task appears automatically on every event form and can't be
  // removed from an event (replaces the old hardcoded name list in EventForm).
  always_show: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateTaskInput {
  name: string;
  individualOnly?: boolean;
  alwaysShow?: boolean;
}

export interface UpdateTaskInput {
  name?: string;
  individualOnly?: boolean;
  alwaysShow?: boolean;
  deletedAt?: string | null;
}
