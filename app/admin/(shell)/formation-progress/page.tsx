import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/src/lib/supabase/server';
import { listMembers } from '@/src/features/members/service';
import FormationProgressBrowser from './FormationProgressBrowser';

export default async function FormationProgressPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect('/login');

  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  const role = user.app_metadata?.role as string | undefined;
  const memberId = user.app_metadata?.member_id as string | undefined;

  if (!tenantId || role !== 'ADMIN' || !memberId) redirect('/login');

  const members = await listMembers(tenantId);

  return (
    <div className="flex flex-col">
      <div className="border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Formation Progress</h1>
        <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
          View member formation progress and record manual talk completions.
        </p>
      </div>
      <FormationProgressBrowser
        members={members ?? []}
        tenantId={tenantId}
        adminMemberId={memberId}
      />
    </div>
  );
}
