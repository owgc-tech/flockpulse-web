import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/src/lib/supabase/server';
import { listDeletedTalks } from '@/src/features/formation/talk.service';
import DeletedTalksTable from './DeletedTalksTable';

export default async function DeletedTalksPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect('/login');

  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  const role = user.app_metadata?.role as string | undefined;
  const token = (await supabase.auth.getSession()).data.session?.access_token;

  if (!tenantId || role !== 'ADMIN' || !token) redirect('/login');

  const talks = await listDeletedTalks(tenantId);

  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-12 dark:bg-black">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Deleted Items</h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Restore soft-deleted courses, modules, and talks.
            </p>
          </div>
          <a
            href="/admin/formation"
            className="text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            ← Formation
          </a>
        </div>

        <nav className="mb-6 flex gap-1 rounded-lg border border-zinc-200 bg-white p-1 dark:border-zinc-800 dark:bg-zinc-950">
          {[
            { href: '/admin/restore/courses', label: 'Courses' },
            { href: '/admin/restore/modules', label: 'Modules' },
            { href: '/admin/restore/talks', label: 'Talks' },
          ].map(({ href, label }) => (
            <a
              key={href}
              href={href}
              className={`flex-1 rounded-md px-3 py-1.5 text-center text-sm font-medium transition-colors ${
                href === '/admin/restore/talks'
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
              }`}
            >
              {label}
            </a>
          ))}
        </nav>

        <DeletedTalksTable initialTalks={talks} token={token} />
      </div>
    </main>
  );
}
