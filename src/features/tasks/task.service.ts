import type { TaskRow, CreateTaskInput, UpdateTaskInput } from './task.types';
import { insertTask, patchTask, getTask, listTasks } from './task.repository';

function err(code: string, message: string): Error & { code: string } {
  const e = new Error(message) as Error & { code: string };
  e.code = code;
  return e;
}

export async function createTask(tenantId: string, input: CreateTaskInput): Promise<TaskRow> {
  if (!input.name?.trim()) throw err('VALIDATION_ERROR', 'name is required');
  if (input.alwaysShow !== undefined && typeof input.alwaysShow !== 'boolean') {
    throw err('VALIDATION_ERROR', 'always_show must be a boolean');
  }
  return await insertTask(tenantId, {
    name: input.name.trim(),
    individualOnly: input.individualOnly,
    alwaysShow: input.alwaysShow,
  });
}

export async function updateTask(
  id: string, tenantId: string, input: UpdateTaskInput
): Promise<TaskRow> {
  if (input.alwaysShow !== undefined && typeof input.alwaysShow !== 'boolean') {
    throw err('VALIDATION_ERROR', 'always_show must be a boolean');
  }
  const existing = await getTask(id, tenantId);
  if (!existing) throw err('NOT_FOUND', 'Task not found');

  if (input.name !== undefined && !input.name.trim()) {
    throw err('VALIDATION_ERROR', 'name cannot be empty');
  }
  const updated = await patchTask(id, tenantId, {
    ...input,
    name: input.name?.trim(),
  });
  if (!updated) throw err('NOT_FOUND', 'Task not found');
  return updated;
}

export async function getTaskById(id: string, tenantId: string): Promise<TaskRow> {
  const task = await getTask(id, tenantId);
  if (!task) throw err('NOT_FOUND', 'Task not found');
  return task;
}

export { listTasks };
