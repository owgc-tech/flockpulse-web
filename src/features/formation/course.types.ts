export interface CourseRow {
  id: string;
  tenant_id: string;
  name: string;
  alias: string | null;
  description: string | null;
  sequence_order: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateCourseInput {
  name: string;
  alias?: string | null;
  description?: string | null;
  sequenceOrder: number;
}

export interface UpdateCourseInput {
  name?: string;
  alias?: string | null;
  description?: string | null;
  sequenceOrder?: number;
  deletedAt?: string | null;
}
