export interface ModuleRow {
  id: string;
  tenant_id: string;
  course_id: string;
  name: string;
  alias: string | null;
  description: string | null;
  sequence_order: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateModuleInput {
  courseId: string;
  name: string;
  alias?: string | null;
  description?: string | null;
  sequenceOrder: number;
}

export interface UpdateModuleInput {
  name?: string;
  alias?: string | null;
  description?: string | null;
  sequenceOrder?: number;
  deletedAt?: string | null;
}
