export interface ModuleRow {
  id: string;
  tenant_id: string;
  course_id: string;
  name: string;
  sequence_order: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateModuleInput {
  courseId: string;
  name: string;
  sequenceOrder: number;
}

export interface UpdateModuleInput {
  name?: string;
  sequenceOrder?: number;
  deletedAt?: string | null;
}
