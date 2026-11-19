import type { TalkRow, CreateTalkInput, UpdateTalkInput } from './talk.types';
import { insertTalk, patchTalk, getTalk, listTalksByModule, getTalkByIdForValidation, listDeletedTalksForTenant, maxActiveTalkSequenceOrder, reorderTalksRpc } from './talk.repository';
import { getModule } from './module.repository';

function err(code: string, message: string): Error & { code: string } {
  const e = new Error(message) as Error & { code: string };
  e.code = code;
  return e;
}

function validateDemographics(input: Pick<CreateTalkInput | UpdateTalkInput, 'forSingleMen' | 'forSingleWomen' | 'forMarriedMen' | 'forMarriedWomen'>) {
  const anySet =
    input.forSingleMen !== undefined ||
    input.forSingleWomen !== undefined ||
    input.forMarriedMen !== undefined ||
    input.forMarriedWomen !== undefined;
  if (!anySet) return; // no demographic fields in this update — skip check
  const anyTrue = input.forSingleMen || input.forSingleWomen || input.forMarriedMen || input.forMarriedWomen;
  if (!anyTrue) {
    throw err('VALIDATION_ERROR', 'At least one demographic audience must be selected');
  }
}

export async function createTalk(tenantId: string, input: CreateTalkInput): Promise<TalkRow> {
  if (!input.name?.trim()) throw err('VALIDATION_ERROR', 'name is required');
  if (!Number.isInteger(input.sequenceOrder) || input.sequenceOrder < 1) {
    throw err('VALIDATION_ERROR', 'sequence_order must be a positive integer');
  }
  validateDemographics(input);
  const parentModule = await getModule(input.moduleId, tenantId);
  if (!parentModule || parentModule.deleted_at) throw err('NOT_FOUND', 'Module not found or deleted');
  // TODO(EPIC-10): audit hook — talk created
  try {
    return await insertTalk(tenantId, { ...input, name: input.name.trim() });
  } catch (e: unknown) {
    if ((e as { code?: string }).code === '23505') {
      throw err('VALIDATION_ERROR', `sequence_order ${input.sequenceOrder} is already taken in this module`);
    }
    throw e;
  }
}

export async function updateTalk(
  id: string, tenantId: string, input: UpdateTalkInput
): Promise<TalkRow> {
  const existing = await getTalk(id, tenantId);
  if (!existing) throw err('NOT_FOUND', 'Talk not found');

  if (input.name !== undefined && !input.name.trim()) {
    throw err('VALIDATION_ERROR', 'name cannot be empty');
  }
  if (input.sequenceOrder !== undefined && (!Number.isInteger(input.sequenceOrder) || input.sequenceOrder < 1)) {
    throw err('VALIDATION_ERROR', 'sequence_order must be a positive integer');
  }
  validateDemographics(input);
  // TODO(EPIC-10): audit hook — talk updated / soft-deleted
  try {
    const updated = await patchTalk(id, tenantId, {
      ...input,
      name: input.name?.trim(),
    });
    if (!updated) throw err('NOT_FOUND', 'Talk not found');
    return updated;
  } catch (e: unknown) {
    const code = (e as { code?: string }).code;
    if (code === '23505') {
      throw err('VALIDATION_ERROR', `sequence_order ${input.sequenceOrder} is already taken in this module`);
    }
    if (code === 'P0001') {
      const msg = (e as Error).message ?? '';
      if (msg.includes('Cannot soft-delete talk')) {
        throw err('INVALID_STATE_TRANSITION', msg);
      }
    }
    throw e;
  }
}

export async function getTalkById(id: string, tenantId: string): Promise<TalkRow> {
  const talk = await getTalk(id, tenantId);
  if (!talk) throw err('NOT_FOUND', 'Talk not found');
  return talk;
}

export async function validateTalkIdForEvent(talkId: string, tenantId: string): Promise<void> {
  const talk = await getTalkByIdForValidation(talkId, tenantId);
  if (!talk || talk.deleted_at !== null) {
    throw err('INVALID_FORMATION_LINK', `talk_id ${talkId} is invalid, soft-deleted, or belongs to a different tenant`);
  }
}

export async function reorderTalks(
  moduleId: string, tenantId: string, orderedIds: string[]
): Promise<void> {
  if (!orderedIds.length) throw err('VALIDATION_ERROR', 'orderedIds must be non-empty');
  try {
    await reorderTalksRpc(moduleId, tenantId, orderedIds);
  } catch (e: unknown) {
    const msg = (e as Error).message ?? '';
    if (msg.includes('different tenant') || msg.includes('module/tenant')) {
      throw err('CROSS_TENANT_ACCESS', msg);
    }
    throw err('VALIDATION_ERROR', msg);
  }
}

export { listTalksByModule };

export interface DeletedTalkRow extends TalkRow {
  module_name: string;
  module_deleted_at: string | null;
}

export async function listDeletedTalks(tenantId: string): Promise<DeletedTalkRow[]> {
  const talks = await listDeletedTalksForTenant(tenantId);
  if (!talks.length) return [];

  const moduleIds = [...new Set(talks.map(t => t.module_id))];
  const modules = await Promise.all(moduleIds.map(id => getModule(id, tenantId)));
  const moduleMap = new Map(
    modules.filter(Boolean).map(m => [m!.id, m!])
  );

  return talks.map(t => ({
    ...t,
    module_name: moduleMap.get(t.module_id)?.name ?? '(unknown)',
    module_deleted_at: moduleMap.get(t.module_id)?.deleted_at ?? null,
  }));
}

export async function restoreTalk(id: string, tenantId: string): Promise<TalkRow> {
  const existing = await getTalk(id, tenantId);
  if (!existing) throw err('NOT_FOUND', 'Talk not found');
  if (existing.deleted_at === null) throw err('VALIDATION_ERROR', 'Talk is not deleted');

  const parentModule = await getModule(existing.module_id, tenantId);
  if (!parentModule) throw err('NOT_FOUND', 'Parent module not found');
  if (parentModule.deleted_at !== null) {
    throw err('INVALID_STATE_TRANSITION', `Restore module "${parentModule.name}" first`);
  }

  const maxOrder = await maxActiveTalkSequenceOrder(existing.module_id, tenantId);
  try {
    const restored = await patchTalk(id, tenantId, {
      deletedAt: null,
      sequenceOrder: maxOrder + 1,
    });
    if (!restored) throw err('NOT_FOUND', 'Talk not found');
    return restored;
  } catch (e: unknown) {
    if ((e as { code?: string }).code === '23505') {
      throw err('VALIDATION_ERROR', 'sequence_order collision during restore — please retry');
    }
    throw e;
  }
}
