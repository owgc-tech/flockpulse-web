import type { ModuleRow, CreateModuleInput, UpdateModuleInput } from './module.types';
import { insertModule, patchModule, getModule, listModulesByCourse, reorderModulesRpc } from './module.repository';
import { getCourse } from './course.repository';

function err(code: string, message: string): Error & { code: string } {
  const e = new Error(message) as Error & { code: string };
  e.code = code;
  return e;
}

export async function createModule(tenantId: string, input: CreateModuleInput): Promise<ModuleRow> {
  if (!input.name?.trim()) throw err('VALIDATION_ERROR', 'name is required');
  if (!Number.isInteger(input.sequenceOrder) || input.sequenceOrder < 1) {
    throw err('VALIDATION_ERROR', 'sequence_order must be a positive integer');
  }
  const course = await getCourse(input.courseId, tenantId);
  if (!course || course.deleted_at) throw err('NOT_FOUND', 'Course not found or deleted');
  // TODO(EPIC-10): audit hook — module created
  try {
    return await insertModule(tenantId, { ...input, name: input.name.trim() });
  } catch (e: unknown) {
    if ((e as { code?: string }).code === '23505') {
      throw err('VALIDATION_ERROR', `sequence_order ${input.sequenceOrder} is already taken in this course`);
    }
    throw e;
  }
}

export async function updateModule(
  id: string, tenantId: string, input: UpdateModuleInput
): Promise<ModuleRow> {
  const existing = await getModule(id, tenantId);
  if (!existing) throw err('NOT_FOUND', 'Module not found');

  if (input.name !== undefined && !input.name.trim()) {
    throw err('VALIDATION_ERROR', 'name cannot be empty');
  }
  if (input.sequenceOrder !== undefined && (!Number.isInteger(input.sequenceOrder) || input.sequenceOrder < 1)) {
    throw err('VALIDATION_ERROR', 'sequence_order must be a positive integer');
  }
  // TODO(EPIC-10): audit hook — module updated / soft-deleted
  try {
    const updated = await patchModule(id, tenantId, {
      ...input,
      name: input.name?.trim(),
    });
    if (!updated) throw err('NOT_FOUND', 'Module not found');
    return updated;
  } catch (e: unknown) {
    const code = (e as { code?: string }).code;
    if (code === '23505') {
      throw err('VALIDATION_ERROR', `sequence_order ${input.sequenceOrder} is already taken in this course`);
    }
    if (code === 'P0001') {
      const msg = (e as Error).message ?? '';
      if (msg.includes('Cannot soft-delete module')) {
        throw err('INVALID_STATE_TRANSITION', msg);
      }
    }
    throw e;
  }
}

export async function getModuleById(id: string, tenantId: string): Promise<ModuleRow> {
  const module = await getModule(id, tenantId);
  if (!module) throw err('NOT_FOUND', 'Module not found');
  return module;
}

export async function reorderModules(
  courseId: string, tenantId: string, orderedIds: string[]
): Promise<void> {
  if (!orderedIds.length) throw err('VALIDATION_ERROR', 'orderedIds must be non-empty');
  try {
    await reorderModulesRpc(courseId, tenantId, orderedIds);
  } catch (e: unknown) {
    const msg = (e as Error).message ?? '';
    if (msg.includes('different tenant') || msg.includes('course/tenant')) {
      throw err('CROSS_TENANT_ACCESS', msg);
    }
    throw err('VALIDATION_ERROR', msg);
  }
}

export { listModulesByCourse };
