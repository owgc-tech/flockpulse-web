import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/src/lib/supabase/server';
import { listMembers } from '@/src/features/members/service';
import { isAdminTier, isExactlyLeaderTier, isLeaderTierOrAbove, type Role } from '@/src/lib/auth/middleware';
import { getAssignedMemberIds } from '@/src/features/confirmations/confirmation.repository';
import FormationProgressBrowser from './FormationProgressBrowser';

export default async function FormationProgressPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect('/login');

  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  const role = user.app_metadata?.role as Role | undefined;
  const memberId = user.app_metadata?.member_id as string | undefined;
  const token = (await supabase.auth.getSession()).data.session?.access_token;

  // DIP-FP-114-web: read-accessible to Leader-tier; "Record completion" is
  // Admin-tier-only, enforced both here (canRecord prop) and in
  // recordManualCompletionAction itself (the server action has no other
  // caller-identity check, so the UI hide alone would not be a real boundary).
  if (!tenantId || !role || !isLeaderTierOrAbove(role) || !memberId || !token) redirect('/login');

  let members = await listMembers(tenantId);
  if (isExactlyLeaderTier(role)) {
    const assignedMemberIds = new Set(await getAssignedMemberIds(tenantId, memberId));
    members = (members ?? []).filter((member) => assignedMemberIds.has(member.id));
  }

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
        token={token}
        canRecord={isAdminTier(role)}
      />
    </div>
  );
}
