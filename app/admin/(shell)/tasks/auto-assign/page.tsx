import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/src/lib/supabase/server';
import { listMembers } from '@/src/features/members/service';
import { listGroups } from '@/src/features/groups/service';
import { listEventTypes } from '@/src/features/event-types/event-type.service';
import { listTasks } from '@/src/features/tasks/task.service';
import { isLeaderTierOrAbove, type Role } from '@/src/lib/auth/middleware';
import TaskAutoAssignPanel from '../_shared/TaskAutoAssignPanel';

// Server Component — resolves auth, fetches members/groups/event types plus
// every active task in the tenant's catalog, then renders the generic
// auto-assign panel (DIP-FP-180-adj-6, replacing the old hardcoded
// prayer-leader-auto-assign/food-assignment-auto-assign pages). No task is
// resolved server-side here — the organizer picks one from the dropdown, and
// the panel resolves/fetches everything else client-side from that point.
// Route is protected by proxy.ts (session + MFA trust). Leader-tier-or-above,
// matching event-tasks-assignments' gating.
export default async function TaskAutoAssignPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect('/login');

  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  const role = user.app_metadata?.role as Role | undefined;
  const token = (await supabase.auth.getSession()).data.session?.access_token;

  if (!tenantId || !role || !isLeaderTierOrAbove(role) || !token) redirect('/login');

  const [members, groups, eventTypes, tasks] = await Promise.all([
    listMembers(tenantId),
    listGroups(tenantId),
    listEventTypes(tenantId),
    listTasks(tenantId),
  ]);

  return (
    <div className="px-6 py-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Auto-assign</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Pick a task, build a roster, order it by priority, then round-robin fill every open slot on upcoming events.
          </p>
        </div>
        <TaskAutoAssignPanel
          tasks={tasks ?? []}
          groups={groups ?? []}
          members={members ?? []}
          eventTypes={eventTypes ?? []}
          token={token}
        />
      </div>
    </div>
  );
}
