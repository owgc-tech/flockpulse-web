import type { CourseRow, CreateCourseInput, UpdateCourseInput } from './course.types';
import { insertCourse, patchCourse, getCourse, listCourses, reorderCoursesRpc, maxActiveCourseSequenceOrder } from './course.repository';

function err(code: string, message: string): Error & { code: string } {
  const e = new Error(message) as Error & { code: string };
  e.code = code;
  return e;
}

export async function createCourse(tenantId: string, input: CreateCourseInput): Promise<CourseRow> {
  if (!input.name?.trim()) throw err('VALIDATION_ERROR', 'name is required');
  if (!Number.isInteger(input.sequenceOrder) || input.sequenceOrder < 1) {
    throw err('VALIDATION_ERROR', 'sequence_order must be a positive integer');
  }
  // TODO(EPIC-10): audit hook — course created
  try {
    return await insertCourse(tenantId, { ...input, name: input.name.trim() });
  } catch (e: unknown) {
    if ((e as { code?: string }).code === '23505') {
      throw err('VALIDATION_ERROR', `sequence_order ${input.sequenceOrder} is already taken in this tenant`);
    }
    throw e;
  }
}

export async function updateCourse(
  id: string, tenantId: string, input: UpdateCourseInput
): Promise<CourseRow> {
  const existing = await getCourse(id, tenantId);
  if (!existing) throw err('NOT_FOUND', 'Course not found');

  if (input.name !== undefined && !input.name.trim()) {
    throw err('VALIDATION_ERROR', 'name cannot be empty');
  }
  if (input.sequenceOrder !== undefined && (!Number.isInteger(input.sequenceOrder) || input.sequenceOrder < 1)) {
    throw err('VALIDATION_ERROR', 'sequence_order must be a positive integer');
  }
  // TODO(EPIC-10): audit hook — course updated / soft-deleted
  try {
    const updated = await patchCourse(id, tenantId, {
      ...input,
      name: input.name?.trim(),
    });
    if (!updated) throw err('NOT_FOUND', 'Course not found');
    return updated;
  } catch (e: unknown) {
    const code = (e as { code?: string }).code;
    if (code === '23505') {
      throw err('VALIDATION_ERROR', `sequence_order ${input.sequenceOrder} is already taken in this tenant`);
    }
    if (code === 'P0001') {
      const msg = (e as Error).message ?? '';
      if (msg.includes('Cannot soft-delete course')) {
        throw err('INVALID_STATE_TRANSITION', msg);
      }
    }
    throw e;
  }
}

export async function getCourseById(id: string, tenantId: string): Promise<CourseRow> {
  const course = await getCourse(id, tenantId);
  if (!course) throw err('NOT_FOUND', 'Course not found');
  return course;
}

export async function reorderCourses(tenantId: string, orderedIds: string[]): Promise<void> {
  if (!orderedIds.length) throw err('VALIDATION_ERROR', 'orderedIds must be non-empty');
  try {
    await reorderCoursesRpc(tenantId, orderedIds);
  } catch (e: unknown) {
    const msg = (e as Error).message ?? '';
    if (msg.includes('different tenant')) throw err('CROSS_TENANT_ACCESS', msg);
    throw err('VALIDATION_ERROR', msg);
  }
}

export { listCourses };

export async function listDeletedCourses(tenantId: string): Promise<CourseRow[]> {
  const all = await listCourses(tenantId, true);
  return all.filter(c => c.deleted_at !== null);
}

export async function restoreCourse(id: string, tenantId: string): Promise<CourseRow> {
  const existing = await getCourse(id, tenantId);
  if (!existing) throw err('NOT_FOUND', 'Course not found');
  if (existing.deleted_at === null) throw err('VALIDATION_ERROR', 'Course is not deleted');

  const maxOrder = await maxActiveCourseSequenceOrder(tenantId);
  try {
    const restored = await patchCourse(id, tenantId, {
      deletedAt: null,
      sequenceOrder: maxOrder + 1,
    });
    if (!restored) throw err('NOT_FOUND', 'Course not found');
    return restored;
  } catch (e: unknown) {
    if ((e as { code?: string }).code === '23505') {
      throw err('VALIDATION_ERROR', 'sequence_order collision during restore — please retry');
    }
    throw e;
  }
}
