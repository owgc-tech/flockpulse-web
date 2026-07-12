import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/src/lib/supabase/server';
import { isAdminTier, type Role } from '@/src/lib/auth/middleware';
import GroupForm from '../GroupForm';

export default async function CreateGroupPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect('/login');

  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  const role = user.app_metadata?.role as Role | undefined;
  const token = (await supabase.auth.getSession()).data.session?.access_token;

  // DIP-FP-114-web: Groups stays fully Admin-tier-only, excluded for Leader-tier.
  if (!tenantId || !role || !isAdminTier(role) || !token) redirect('/login');

  return (
    <div className="px-6 py-8">
      <div className="mx-auto max-w-lg">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Create group</h1>
        </div>
        <GroupForm token={token} />
      </div>
    </div>
  );
}
