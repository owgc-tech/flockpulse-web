import { createClient } from '@supabase/supabase-js';

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const COLS = 'id, name, created_at, updated_at, created_by, updated_by, deleted_at';

// includeDeleted defaults to false — matches listMembers()'s convention from DIP-FP-69-FP-72.
// Existing callers (event target/food-assignment pickers etc.) should only ever offer active
// groups; the Groups List screen needs both active and deactivated to display status.
export async function listGroups(tenantId: string, includeDeleted = false) {
  let q = serviceClient()
    .from('groups')
    .select(COLS)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true });

  if (!includeDeleted) q = (q as any).is('deleted_at', null);

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
    throw error;
  }
}
