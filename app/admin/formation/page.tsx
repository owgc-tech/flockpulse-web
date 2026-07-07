import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/src/lib/supabase/server';
import { listCourses } from '@/src/features/formation/course.service';
import FormationBrowser from './FormationBrowser';

export default async function FormationPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect('/login');

  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  const role = user.app_metadata?.role as string | undefined;
  const token = (await supabase.auth.getSession()).data.session?.access_token;

  if (!tenantId || role !== 'ADMIN' || !token) redirect('/login');

  const courses = await listCourses(tenantId);

  return (
    <main className="flex min-h-screen flex-col bg-zinc-50 dark:bg-black">
      <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Formation</h1>
          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
            Manage courses, modules, and talks.
          </p>
        </div>
        <nav className="flex gap-4 text-sm text-zinc-500 dark:text-zinc-400">
          <a href="/admin/invitations" className="hover:text-zinc-900 dark:hover:text-zinc-100">Invitations</a>
        </nav>
      </div>
      <FormationBrowser initialCourses={courses} token={token} />
    </main>
  );
}
