import type { EventTypeRow, CreateEventTypeInput, UpdateEventTypeInput } from './event-type.types';
import { insertEventType, patchEventType, getEventType, listEventTypes, listEventTypesWithUsageCounts } from './event-type.repository';

function err(code: string, message: string): Error & { code: string } {
  const e = new Error(message) as Error & { code: string };
  e.code = code;
  return e;
}

export async function createEventType(tenantId: string, input: CreateEventTypeInput): Promise<EventTypeRow> {
  if (!input.name?.trim()) throw err('VALIDATION_ERROR', 'name is required');
  if (!input.code?.trim()) throw err('VALIDATION_ERROR', 'code is required');
  try {
    return await insertEventType(tenantId, { name: input.name.trim(), code: input.code.trim() });
  } catch (e: unknown) {
    if ((e as { code?: string }).code === '23505') {
      throw err('VALIDATION_ERROR', `code ${input.code} is already taken in this tenant`);
    }
    throw e;
  }
}

export async function updateEventType(
  id: string, tenantId: string, input: UpdateEventTypeInput
): Promise<EventTypeRow> {
  const existing = await getEventType(id, tenantId);
  if (!existing) throw err('NOT_FOUND', 'Event type not found');

  if (input.name !== undefined && !input.name.trim()) {
    throw err('VALIDATION_ERROR', 'name cannot be empty');
  }
  if (input.code !== undefined && !input.code.trim()) {
    throw err('VALIDATION_ERROR', 'code cannot be empty');
  }
  try {
    const updated = await patchEventType(id, tenantId, {
      ...input,
      name: input.name?.trim(),
      code: input.code?.trim(),
    });
    if (!updated) throw err('NOT_FOUND', 'Event type not found');
    return updated;
  } catch (e: unknown) {
    const code = (e as { code?: string }).code;
    if (code === '23505') {
      throw err('VALIDATION_ERROR', `code ${input.code} is already taken in this tenant`);
    }
    // DIP-FP-191-web: trigger_block_system_event_type_rename_or_delete lives on
    // event_types itself (BEFORE UPDATE) — same P0001 + message-substring
    // convention as groups.service.ts's updateGroup()/softDeleteGroup() mapping
    // for the FP-181 guard trigger.
    if ((e as { code?: string; message?: string }).code === 'P0001' && ((e as { message?: string }).message ?? '').includes('SYSTEM_MANAGED_GROUP')) {
      throw err('SYSTEM_MANAGED_GROUP', (e as Error).message);
    }
    throw e;
  }
}

export async function getEventTypeById(id: string, tenantId: string): Promise<EventTypeRow> {
  const eventType = await getEventType(id, tenantId);
  if (!eventType) throw err('NOT_FOUND', 'Event type not found');
  return eventType;
}

export { listEventTypes, listEventTypesWithUsageCounts };
