export interface CourseRow {
  id: string;
  tenant_id: string;
  name: string;
  sequence_order: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateCourseInput {
  name: string;
  sequenceOrder: number;
}

export interface UpdateCourseInput {
  name?: string;
  sequenceOrder?: number;
  deletedAt?: string | null;
}
