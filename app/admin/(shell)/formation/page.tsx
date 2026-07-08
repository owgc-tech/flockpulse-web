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
    <div className="flex flex-col">
      <div className="border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Formation</h1>
        <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
          Manage courses, modules, and talks.
        </p>
      </div>
      <FormationBrowser initialCourses={courses} token={token} />
    </div>
  );
}
