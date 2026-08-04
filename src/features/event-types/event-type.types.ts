export interface EventTypeRow {
  id: string;
  tenant_id: string;
  name: string;
  code: string;
  // DIP-FP-191-web: mirrors groups.system_key from FP-181 — 'ANNOUNCEMENT' for
  // the one system-managed row every tenant has, null for every other type.
  system_key: string | null;
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
