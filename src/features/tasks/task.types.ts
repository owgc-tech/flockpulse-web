export interface TaskRow {
  id: string;
  tenant_id: string;
  name: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateTaskInput {
  name: string;
}

export interface UpdateTaskInput {
  name?: string;
  deletedAt?: string | null;
}
