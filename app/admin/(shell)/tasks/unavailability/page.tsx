import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/src/lib/supabase/server';
import { listMembers } from '@/src/features/members/service';
import { listUnavailabilityForAdmin } from '@/src/features/members/member_unavailability.service';
import { isLeaderTierOrAbove, type Role } from '@/src/lib/auth/middleware';
import UnavailabilityTable from './UnavailabilityTable';

// DIP-FP-199-web: read-only — an admin/leader can see who's unavailable
// before assigning tasks, rather than only discovering it via the FP-190
// hard block. Leader-tier-or-above, matching /admin/tasks/auto-assign's own
// gating — this page exists specifically to support task assignment, which
// Leaders can also do.
export default async function UnavailabilityPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect('/login');

  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  const role = user.app_metadata?.role as Role | undefined;
  const token = (await supabase.auth.getSession()).data.session?.access_token;

  if (!tenantId || !role || !isLeaderTierOrAbove(role) || !token) redirect('/login');

  const [members, ranges] = await Promise.all([
    listMembers(tenantId),
    listUnavailabilityForAdmin(tenantId, {}),
  ]);

  return (
    <div className="px-6 py-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Unavailability</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Every unavailability range members have filed. Filter by name or date range to check
            before assigning a task, manually or via Auto-Assign.
          </p>
        </div>
        <UnavailabilityTable
          initialRanges={ranges}
          members={members.map(m => ({ id: m.id, first_name: m.first_name, last_name: m.last_name }))}
          token={token}
        />
      </div>
    </div>
  );
}
