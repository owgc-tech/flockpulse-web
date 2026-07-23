import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/src/lib/supabase/server';
import { listTasks } from '@/src/features/tasks/task.service';
import { isAdminTier, type Role } from '@/src/lib/auth/middleware';
import TasksTable from './TasksTable';

// Server Component — resolves auth, fetches tasks (including archived, so
// the table can show status), then passes them to the interactive
// TasksTable Client Component. Route is protected by proxy.ts (session + MFA
// trust). Admin-tier-only, matching Event Types' page.
export default async function TasksPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect('/login');

  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  const role = user.app_metadata?.role as Role | undefined;
  const token = (await supabase.auth.getSession()).data.session?.access_token;

  if (!tenantId || !role || !isAdminTier(role) || !token) redirect('/login');

  const tasks = await listTasks(tenantId, true);

  return (
    <div className="px-6 py-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Tasks</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            The task catalog available for assignment on events in this organisation.
          </p>
        </div>
        <div className="mb-6 flex gap-3">
          <Link
            href="/admin/tasks/auto-assign"
            className="rounded-full border border-zinc-200 px-4 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Auto-Assign
          </Link>
        </div>
        <TasksTable initialTasks={tasks} token={token} />
      </div>
    </div>
  );
}
