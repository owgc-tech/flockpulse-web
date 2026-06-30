import { createClient } from '@supabase/supabase-js';

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function listGroups(tenantId: string) {
  const { data, error } = await serviceClient()
    .from('groups')
    .select('id, name, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data;
}

export async function createGroup(tenantId: string, name: string) {
  const { data, error } = await serviceClient()
    .from('groups')
    .insert({ tenant_id: tenantId, name })
    .select('id, name, created_at')
    .single();

  if (error) throw error;
  return data;
}

// Soft-delete groups via a deleted_at flag if the column exists, otherwise this is a
// tombstone update. Groups table currently has no deleted_at — update name to signal
// removal is not the product pattern; instead the group row itself is preserved for
// FK integrity. For now: Admin can rename or archive groups. Hard-delete is blocked
// at the policy layer (no DELETE policy on groups).
export async function updateGroup(id: string, tenantId: string, name: string) {
  const { data, error } = await serviceClient()
    .from('groups')
    .update({ name })
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select('id, name')
    .single();

  if (error) throw error;
  return data;
}
