export interface EventTypeRow {
  id: string;
  tenant_id: string;
  name: string;
  code: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateEventTypeInput {
  name: string;
  code: string;
}

export interface UpdateEventTypeInput {
  name?: string;
  code?: string;
  deletedAt?: string | null;
}
