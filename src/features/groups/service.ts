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

