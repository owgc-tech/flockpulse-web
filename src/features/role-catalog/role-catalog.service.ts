import {
  listRoleCatalog,
  getRoleCatalogEntry,
  insertRoleCatalogEntry,
  patchRoleCatalogEntry,
  reassignRoleCatalogEntry,
  getRoleCatalogEntryUsage,
} from './role-catalog.repository';
import type {
  RoleCatalogEntryRow,
  RoleTier,
  CreateRoleCatalogEntryInput,
  UpdateRoleCatalogEntryInput,
  ReassignRoleCatalogEntryResult,
} from './role-catalog.types';

function err(code: string, message: string): Error & { code: string } {
  const e = new Error(message) as Error & { code: string };
  e.code = code;
  return e;
}

const VALID_TIERS: RoleTier[] = ['ADMIN', 'LEADER', 'MEMBER'];

export async function createRoleCatalogEntry(
  tenantId: string, input: CreateRoleCatalogEntryInput
): Promise<RoleCatalogEntryRow> {
  if (!input.name?.trim()) throw err('VALIDATION_ERROR', 'name is required');
  if (!VALID_TIERS.includes(input.tier)) throw err('VALIDATION_ERROR', 'tier must be ADMIN, LEADER, or MEMBER');

  try {
    return await insertRoleCatalogEntry(tenantId, input.name.trim(), input.tier);
  } catch (e: unknown) {
    if ((e as { code?: string }).code === '23505') {
      throw err('VALIDATION_ERROR', `A role named "${input.name}" already exists in this tenant`);
    }
    throw e;
  }
}

// DIP-FP-192-web: mirrors softDeleteMember()'s exact P0001 + message-substring
// + parsed-count convention for the delete-block trigger. Rename and delete
// share this one function (matches updateEventType()'s precedent) — tier is
// deliberately not accepted here at all (see role-catalog.types.ts).
export async function updateRoleCatalogEntry(
  id: string, tenantId: string, input: UpdateRoleCatalogEntryInput
): Promise<RoleCatalogEntryRow> {
  const existing = await getRoleCatalogEntry(id, tenantId);
  if (!existing) throw err('NOT_FOUND', 'Role catalog entry not found');

  if (input.name !== undefined && !input.name.trim()) {
    throw err('VALIDATION_ERROR', 'name cannot be empty');
  }

  try {
    return await patchRoleCatalogEntry(id, tenantId, {
      ...input,
      name: input.name?.trim(),
    });
  } catch (e: unknown) {
    const error = e as { code?: string; message?: string };
    if (error.code === '23505') {
      throw err('VALIDATION_ERROR', `A role named "${input.name}" already exists in this tenant`);
    }
    if (error.code === 'P0001' && (error.message ?? '').includes('ROLE_CATALOG_ENTRY_IN_USE')) {
      const e2 = new Error(error.message) as Error & { code: string; memberCount?: number; invitationCount?: number };
      e2.code = 'INVALID_STATE_TRANSITION';
      const match = error.message!.match(/assigned to (\d+) member\(s\) and (\d+) pending invitation\(s\)/);
      if (match) {
        e2.memberCount = parseInt(match[1], 10);
        e2.invitationCount = parseInt(match[2], 10);
      }
      throw e2;
    }
    throw e;
  }
}

export async function getRoleCatalogEntryById(id: string, tenantId: string): Promise<RoleCatalogEntryRow> {
  const entry = await getRoleCatalogEntry(id, tenantId);
  if (!entry) throw err('NOT_FOUND', 'Role catalog entry not found');
  return entry;
}

export async function reassignRoleCatalogEntryEntries(
  fromEntryId: string, toEntryId: string, tenantId: string
): Promise<ReassignRoleCatalogEntryResult> {
  if (!fromEntryId || !toEntryId) throw err('VALIDATION_ERROR', 'fromEntryId and toEntryId are required');

  try {
    return await reassignRoleCatalogEntry(fromEntryId, toEntryId, tenantId);
  } catch (e: unknown) {
    const message = (e as { message?: string }).message ?? '';
    if (message.includes('VALIDATION_ERROR')) throw err('VALIDATION_ERROR', message);
    if (message.includes('NOT_FOUND_IN_TENANT')) throw err('NOT_FOUND_IN_TENANT', message);
    if (message.includes('TIER_MISMATCH')) throw err('TIER_MISMATCH', message);
    throw e;
  }
}

export { listRoleCatalog, getRoleCatalogEntryUsage };
