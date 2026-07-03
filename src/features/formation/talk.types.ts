export interface TalkRow {
  id: string;
  tenant_id: string;
  module_id: string;
  name: string;
  sequence_order: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateTalkInput {
  moduleId: string;
  name: string;
  sequenceOrder: number;
}

export interface UpdateTalkInput {
  name?: string;
  sequenceOrder?: number;
  deletedAt?: string | null;
}
