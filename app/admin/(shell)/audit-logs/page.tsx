import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/src/lib/supabase/server';
import { listMembers } from '@/src/features/members/service';
import { isAdminTier, type Role } from '@/src/lib/auth/middleware';
import AuditLogBrowser from './AuditLogBrowser';

export default async function AuditLogsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect('/login');

  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  const role = user.app_metadata?.role as Role | undefined;
  const token = (await supabase.auth.getSession()).data.session?.access_token;

  // STORY-10.2: Admin-tier-only (unlike Reports/Formation Progress) — SR_COORDINATOR
  // and other Admin-tier synonyms (FP-113) are included via isAdminTier's rank check.
  if (!tenantId || !role || !isAdminTier(role) || !token) redirect('/login');

  const members = await listMembers(tenantId, true);

  return (
    <div className="flex flex-col">
      <div className="border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Audit Logs</h1>
        <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
          Query and filter the tenant&apos;s audit trail by entity, action, actor, and date range.
        </p>
      </div>

      <div className="p-6">
        <AuditLogBrowser members={members ?? []} token={token} />
      </div>
    </div>
  );
}
