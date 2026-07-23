import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/src/lib/supabase/server';
import { listMembers } from '@/src/features/members/service';
import { getPrayerLeaderAutoAssignData } from '@/src/features/tasks/autoAssign.service';
import { isLeaderTierOrAbove, type Role } from '@/src/lib/auth/middleware';
import TaskAutoAssignPanel from '../_shared/TaskAutoAssignPanel';

// Server Component — resolves auth, fetches members plus the Prayer Leader
// task's open upcoming slots, then renders the shared auto-assign panel with
// individualOnly=true (Prayer Leader is individuals only, never groups).
// Route is protected by proxy.ts (session + MFA trust). Leader-tier-or-above,
// matching event-tasks-assignments' gating.
export default async function PrayerLeaderAutoAssignPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect('/login');

  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  const role = user.app_metadata?.role as Role | undefined;
  const token = (await supabase.auth.getSession()).data.session?.access_token;

  if (!tenantId || !role || !isLeaderTierOrAbove(role) || !token) redirect('/login');

  // getPrayerLeaderAutoAssignData resolves and validates the "Prayer Leader"
  // task exists in this tenant's catalog before the panel renders — its
  // slots are re-fetched live by the client via slotsEndpoint below.
  const [members] = await Promise.all([
    listMembers(tenantId),
    getPrayerLeaderAutoAssignData(tenantId),
  ]);

  return (
    <div className="px-6 py-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Auto-assign Prayer Leader</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Build a roster of individuals, order it by priority, then round-robin fill every open Prayer Leader slot on upcoming events.
          </p>
        </div>
        <TaskAutoAssignPanel
          taskLabel="Prayer Leader"
          individualOnly={true}
          slotsEndpoint="/api/tasks/auto-assign/prayer-leader/slots"
          runEndpoint="/api/tasks/auto-assign/prayer-leader"
          groups={[]}
          members={members ?? []}
          token={token}
        />
      </div>
    </div>
  );
}
