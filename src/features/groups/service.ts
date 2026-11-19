import { createClient } from '@supabase/supabase-js';

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const COLS = 'id, name, created_at, updated_at, created_by, updated_by, deleted_at, owner_member_id';

// includeDeleted defaults to false — matches listMembers()'s convention from DIP-FP-69-FP-72.
// Existing callers (event target/food-assignment pickers etc.) should only ever offer active
// groups; the Groups List screen needs both active and deactivated to display status.
export async function listGroups(tenantId: string, includeDeleted = false) {
  let q = serviceClient()
    .from('groups')
    .select(COLS)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true });

  if (!includeDeleted) q = q.is('deleted_at', null);

  const { data, error } = await q;
  if (error) throw error;
  return data;
}

// FP-70: Edit-screen prefill — same tenant-scoping pattern as listGroups, single row.
export async function getGroupById(id: string, tenantId: string) {
  const { data, error } = await serviceClient()
    .from('groups')
    .select(COLS)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .single();

  if (error || !data) {
    const err = new Error('Group not found for this tenant') as Error & { code: string };
    err.code = 'NOT_FOUND_IN_TENANT';
    throw err;
  }
  return data;
}

// FP-70: create/update/soft-delete all go through SECURITY DEFINER RPCs that write an
// audit_logs entry in the same transaction — never a plain .insert()/.update(), per the
// established write_audit_log() convention confirmed live for this DIP.
export async function createGroup(tenantId: string, name: string, actorMemberId: string) {
  const { data, error } = await serviceClient().rpc('create_group_with_audit', {
    p_tenant_id: tenantId,
    p_name: name,
    p_actor_member_id: actorMemberId,
  });

  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row;
}

export async function updateGroup(id: string, tenantId: string, name: string, actorMemberId: string) {
  const { data, error } = await serviceClient().rpc('update_group_with_audit', {
    p_group_id: id,
    p_tenant_id: tenantId,
    p_name: name,
    p_actor_member_id: actorMemberId,
  });

  if (error) {
    if ((error.message ?? '').includes('NOT_FOUND_IN_TENANT')) {
      const err = new Error('Group not found for this tenant') as Error & { code: string };
      err.code = 'NOT_FOUND_IN_TENANT';
      throw err;
    }
    // DIP-FP-181: trigger_block_system_group_rename_or_delete lives on groups
    // itself (BEFORE UPDATE), so it fires identically whether this RPC's own
    // internal UPDATE is the source or a hypothetical direct client write —
    // same P0001 + message-substring convention as members.service.ts's
    // guard-trigger mappings.
    if (error.code === 'P0001' && (error.message ?? '').includes('SYSTEM_MANAGED_GROUP')) {
      const err = new Error(error.message) as Error & { code: string };
      err.code = 'SYSTEM_MANAGED_GROUP';
      throw err;
    }
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row;
}

export async function softDeleteGroup(id: string, tenantId: string, actorMemberId: string) {
  const { error } = await serviceClient().rpc('soft_delete_group_with_audit', {
    p_group_id: id,
    p_tenant_id: tenantId,
    p_actor_member_id: actorMemberId,
  });

  if (error) {
    if ((error.message ?? '').includes('NOT_FOUND_IN_TENANT')) {
      const err = new Error('Group not found for this tenant') as Error & { code: string };
      err.code = 'NOT_FOUND_IN_TENANT';
      throw err;
    }
    // DIP-FP-181: same guard-trigger mapping as updateGroup() above.
    if (error.code === 'P0001' && (error.message ?? '').includes('SYSTEM_MANAGED_GROUP')) {
      const err = new Error(error.message) as Error & { code: string };
      err.code = 'SYSTEM_MANAGED_GROUP';
      throw err;
    }
    throw error;
  }
}

// FP-146: single-group owner reassignment, Admin-only. Mirrors updateGroup's
// NOT_FOUND_IN_TENANT mapping, plus VALIDATION_ERROR for an inactive/foreign-tenant
// new owner (matches bulkReassignLeaderMembers's error-mapping convention).
export async function reassignGroupOwner(
  groupId: string, tenantId: string, newOwnerMemberId: string, actorMemberId: string
) {
  const { data, error } = await serviceClient().rpc('reassign_group_owner_with_audit', {
    p_group_id: groupId,
    p_tenant_id: tenantId,
    p_new_owner_member_id: newOwnerMemberId,
    p_actor_member_id: actorMemberId,
  });

  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('NOT_FOUND_IN_TENANT')) {
      const err = new Error('Group not found for this tenant') as Error & { code: string };
      err.code = 'NOT_FOUND_IN_TENANT';
      throw err;
    }
    if (msg.includes('VALIDATION_ERROR')) {
      const err = new Error(msg) as Error & { code: string };
      err.code = 'VALIDATION_ERROR';
      throw err;
    }
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row;
}

// FP-146: atomic bulk reassignment — thin wrapper over
// bulk_reassign_group_owner_with_audit(), which reuses reassign_group_owner_with_audit()
// per affected group inside one transaction (mirrors bulkReassignLeaderMembers's shape).
export async function bulkReassignGroupOwner(
  outgoingOwnerId: string, incomingOwnerId: string, tenantId: string, actorMemberId: string
) {
  const { data, error } = await serviceClient().rpc('bulk_reassign_group_owner_with_audit', {
    p_outgoing_owner_id: outgoingOwnerId,
    p_incoming_owner_id: incomingOwnerId,
    p_tenant_id: tenantId,
    p_actor_member_id: actorMemberId,
  });

  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('VALIDATION_ERROR')) {
      const err = new Error(msg) as Error & { code: string };
      err.code = 'VALIDATION_ERROR';
      throw err;
    }
    if (msg.includes('CROSS_TENANT_ACCESS')) {
      const err = new Error(msg) as Error & { code: string };
      err.code = 'CROSS_TENANT_ACCESS';
      throw err;
    }
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row;
}
