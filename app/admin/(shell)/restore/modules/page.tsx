import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/src/lib/supabase/server';
import { listDeletedModules } from '@/src/features/formation/module.service';
import { isAdminTier, type Role } from '@/src/lib/auth/middleware';
import DeletedModulesTable from './DeletedModulesTable';

export default async function DeletedModulesPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect('/login');

  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  const role = user.app_metadata?.role as Role | undefined;
  const token = (await supabase.auth.getSession()).data.session?.access_token;

  // DIP-FP-114-web: Restore stays fully Admin-tier-only (Formation-adjacent
  // recovery tool), excluded for Leader-tier.
  if (!tenantId || !role || !isAdminTier(role) || !token) redirect('/login');

  const modules = await listDeletedModules(tenantId);

  return (
    <div className="px-6 py-8">
      <h2 className="mb-1 text-base font-semibold text-zinc-900 dark:text-zinc-50">Deleted Modules</h2>
      <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
        Restore a deleted module. Its parent course must be active first.
      </p>
      <DeletedModulesTable initialModules={modules} token={token} />
    </div>
  );
}
