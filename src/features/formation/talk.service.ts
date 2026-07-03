import type { TalkRow, CreateTalkInput, UpdateTalkInput } from './talk.types';
import { insertTalk, patchTalk, getTalk, listTalksByModule, getTalkByIdForValidation } from './talk.repository';
import { getModule } from './module.repository';

function err(code: string, message: string): Error & { code: string } {
  const e = new Error(message) as Error & { code: string };
  e.code = code;
  return e;
}

export async function createTalk(tenantId: string, input: CreateTalkInput): Promise<TalkRow> {
  if (!input.name?.trim()) throw err('VALIDATION_ERROR', 'name is required');
  if (!Number.isInteger(input.sequenceOrder) || input.sequenceOrder < 1) {
    throw err('VALIDATION_ERROR', 'sequence_order must be a positive integer');
  }
  const module = await getModule(input.moduleId, tenantId);
  if (!module || module.deleted_at) throw err('NOT_FOUND', 'Module not found or deleted');
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
    // DB trigger raises P0001 when a referenced talk is soft-deleted
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

export { listTalksByModule };
