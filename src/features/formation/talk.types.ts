export interface TalkRow {
  id: string;
  tenant_id: string;
  module_id: string;
  name: string;
  alias: string | null;
  description: string | null;
  sequence_order: number;
  for_single_men: boolean;
  for_single_women: boolean;
  for_married_men: boolean;
  for_married_women: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateTalkInput {
  moduleId: string;
  name: string;
  alias?: string | null;
  description?: string | null;
  sequenceOrder: number;
  forSingleMen?: boolean;
  forSingleWomen?: boolean;
  forMarriedMen?: boolean;
  forMarriedWomen?: boolean;
}

export interface UpdateTalkInput {
  name?: string;
  alias?: string | null;
  description?: string | null;
  sequenceOrder?: number;
  forSingleMen?: boolean;
  forSingleWomen?: boolean;
  forMarriedMen?: boolean;
  forMarriedWomen?: boolean;
  deletedAt?: string | null;
}
