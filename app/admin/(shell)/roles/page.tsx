import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/src/lib/supabase/server';
import { listRoleCatalog } from '@/src/features/role-catalog/role-catalog.service';
import { isAdminTier, type Role } from '@/src/lib/auth/middleware';
import RoleCatalogTable from './RoleCatalogTable';

// Server Component — resolves auth, fetches the role catalog (including
// soft-deleted, so the table can show status), then passes it to the
// interactive RoleCatalogTable Client Component. Admin-tier-only, matching
// Event Types'/Tasks' own pages.
export default async function RolesPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect('/login');

  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  const role = user.app_metadata?.role as Role | undefined;
  const token = (await supabase.auth.getSession()).data.session?.access_token;

  if (!tenantId || !role || !isAdminTier(role) || !token) redirect('/login');

  const entries = await listRoleCatalog(tenantId, true);

  return (
    <div className="px-6 py-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Roles</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            The role titles available when inviting or editing a member in this organisation.
            Each role belongs to one of three access tiers — Admin, Leader, or Member — which
            is fixed at creation and cannot be changed afterward.
          </p>
        </div>
        <RoleCatalogTable initialEntries={entries} token={token} />
      </div>
    </div>
  );
}
