import { createClient } from '@supabase/supabase-js';
import type { RoleCatalogEntryRow, RoleTier, ReassignRoleCatalogEntryResult } from './role-catalog.types';

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const COLS = 'id, tenant_id, name, tier, sort_order, deleted_at, created_at, updated_at';

// sort_order first (preserves the seeded 7's exact original order), name as
// tiebreaker for anything sharing a sort_order (shouldn't happen in practice,
// but keeps the ordering deterministic rather than left to row-arrival order).
export async function listRoleCatalog(tenantId: string, includeDeleted = false): Promise<RoleCatalogEntryRow[]> {
  let q = serviceClient()
    .from('role_catalog')
    .select(COLS)
    .eq('tenant_id', tenantId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (!includeDeleted) q = q.is('deleted_at', null);

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as RoleCatalogEntryRow[];
}

export async function getRoleCatalogEntry(id: string, tenantId: string): Promise<RoleCatalogEntryRow | null> {
  const { data, error } = await serviceClient()
    .from('role_catalog')
    .select(COLS)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .single();

  if (error) return null;
  return data as RoleCatalogEntryRow;
}

// New entries sort after everything else — max(sort_order) + 1 per tenant.
export async function insertRoleCatalogEntry(tenantId: string, name: string, tier: RoleTier): Promise<RoleCatalogEntryRow> {
  const { data: maxRow } = await serviceClient()
    .from('role_catalog')
    .select('sort_order')
    .eq('tenant_id', tenantId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextSortOrder = (maxRow?.sort_order ?? 0) + 1;

  const { data, error } = await serviceClient()
    .from('role_catalog')
    .insert({ tenant_id: tenantId, name, tier, sort_order: nextSortOrder })
    .select(COLS)
    .single();

  if (error) throw error;
  return data as RoleCatalogEntryRow;
}

// Handles both rename and soft-delete — mirrors event-type.repository.ts's
// patchEventType() exactly (same single-PATCH-does-both shape). The delete-block
// trigger (block_role_catalog_entry_delete_while_in_use) fires on the same
// plain .update() call regardless of caller, same as every other guard
// trigger in this codebase.
export async function patchRoleCatalogEntry(
  id: string, tenantId: string, input: { name?: string; deletedAt?: string | null }
): Promise<RoleCatalogEntryRow> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.deletedAt !== undefined) patch.deleted_at = input.deletedAt;

  const { data, error } = await serviceClient()
    .from('role_catalog')
    .update(patch)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select(COLS)
    .single();

  if (error) throw error;
  return data as RoleCatalogEntryRow;
}

// DIP-FP-192-web addition: not in the DIP's literal Implementation Plan, but
// needed so the reassign page can show who's actually being moved (matching
// BulkReassignForm.tsx's own "Currently assigned" list), not just the
// blocked-delete banner's bare counts.
export async function getRoleCatalogEntryUsage(
  entryId: string, tenantId: string
): Promise<{ members: { id: string; first_name: string; last_name: string }[]; invitations: { id: string; email: string }[] }> {
  const db = serviceClient();
  const [membersResult, invitationsResult] = await Promise.all([
    db.from('members').select('id, first_name, last_name').eq('role_catalog_entry_id', entryId).eq('tenant_id', tenantId).is('deleted_at', null),
    db.from('invitations').select('id, email').eq('role_catalog_entry_id', entryId).eq('tenant_id', tenantId).eq('status', 'PENDING'),
  ]);
  if (membersResult.error) throw membersResult.error;
  if (invitationsResult.error) throw invitationsResult.error;
  return {
    members: (membersResult.data ?? []) as { id: string; first_name: string; last_name: string }[],
    invitations: (invitationsResult.data ?? []) as { id: string; email: string }[],
  };
}

export async function reassignRoleCatalogEntry(
  fromEntryId: string, toEntryId: string, tenantId: string
): Promise<ReassignRoleCatalogEntryResult> {
  const { data, error } = await serviceClient().rpc('reassign_role_catalog_entry', {
    p_from_entry_id: fromEntryId,
    p_to_entry_id: toEntryId,
    p_tenant_id: tenantId,
  });

  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as ReassignRoleCatalogEntryResult;
}
