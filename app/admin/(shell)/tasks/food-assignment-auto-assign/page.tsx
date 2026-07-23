import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/src/lib/supabase/server';
import { listMembers } from '@/src/features/members/service';
import { listGroups } from '@/src/features/groups/service';
import { getFoodAssignmentAutoAssignData } from '@/src/features/tasks/autoAssign.service';
import { isLeaderTierOrAbove, type Role } from '@/src/lib/auth/middleware';
import TaskAutoAssignPanel from '../_shared/TaskAutoAssignPanel';

// Server Component — resolves auth, fetches members/groups plus the Food
// Assignment task's open upcoming slots, then renders the shared auto-assign
// panel with individualOnly=false (Food Assignment allows individuals and/or
// groups). Route is protected by proxy.ts (session + MFA trust).
// Leader-tier-or-above, matching event-tasks-assignments' gating.
export default async function FoodAssignmentAutoAssignPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect('/login');

  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  const role = user.app_metadata?.role as Role | undefined;
  const token = (await supabase.auth.getSession()).data.session?.access_token;

  if (!tenantId || !role || !isLeaderTierOrAbove(role) || !token) redirect('/login');

  // getFoodAssignmentAutoAssignData resolves and validates the "Food
  // Assignment" task exists in this tenant's catalog before the panel
  // renders — its slots are re-fetched live by the client via slotsEndpoint
  // below.
  const [members, groups] = await Promise.all([
    listMembers(tenantId),
    listGroups(tenantId),
    getFoodAssignmentAutoAssignData(tenantId),
  ]);

  return (
    <div className="px-6 py-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Auto-assign Food Assignment</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Build a roster of individuals and/or groups, order it by priority, then round-robin fill every open Food Assignment slot on upcoming events.
          </p>
        </div>
        <TaskAutoAssignPanel
          taskLabel="Food Assignment"
          individualOnly={false}
          slotsEndpoint="/api/tasks/auto-assign/food-assignment/slots"
          runEndpoint="/api/tasks/auto-assign/food-assignment"
          groups={groups ?? []}
          members={members ?? []}
          token={token}
        />
      </div>
    </div>
  );
}
