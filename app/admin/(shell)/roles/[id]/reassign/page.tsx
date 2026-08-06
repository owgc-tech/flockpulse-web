import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/src/lib/supabase/server';
import { listRoleCatalog, getRoleCatalogEntryById, getRoleCatalogEntryUsage } from '@/src/features/role-catalog/role-catalog.service';
import { isAdminTier, type Role } from '@/src/lib/auth/middleware';
import RoleReassignForm from './RoleReassignForm';

export default async function RoleReassignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect('/login');

  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  const role = user.app_metadata?.role as Role | undefined;
  const token = (await supabase.auth.getSession()).data.session?.access_token;

  if (!tenantId || !role || !isAdminTier(role) || !token) redirect('/login');

  let entry;
  try {
    entry = await getRoleCatalogEntryById(id, tenantId);
  } catch {
    redirect('/admin/roles');
  }

  const [allEntries, usage] = await Promise.all([
    listRoleCatalog(tenantId),
    getRoleCatalogEntryUsage(id, tenantId),
  ]);
  // Same tier only — the RPC itself also validates this, this is just the UI's offer set.
  const sameTierOptions = allEntries.filter(e => e.tier === entry.tier && e.id !== entry.id);

  return (
    <div className="px-6 py-8">
      <div className="mx-auto max-w-2xl">
        <RoleReassignForm token={token} outgoingEntry={entry} tierOptions={sameTierOptions} usage={usage} />
      </div>
    </div>
  );
}
