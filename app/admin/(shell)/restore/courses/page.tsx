import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/src/lib/supabase/server';
import { listDeletedCourses } from '@/src/features/formation/course.service';
import DeletedCoursesTable from './DeletedCoursesTable';

export default async function DeletedCoursesPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect('/login');

  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  const role = user.app_metadata?.role as string | undefined;
  const token = (await supabase.auth.getSession()).data.session?.access_token;

  if (!tenantId || role !== 'ADMIN' || !token) redirect('/login');

  const courses = await listDeletedCourses(tenantId);

  return (
    <div className="px-6 py-8">
      <h2 className="mb-1 text-base font-semibold text-zinc-900 dark:text-zinc-50">Deleted Courses</h2>
      <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
        Restore a deleted course to make it visible again in Formation.
      </p>
      <DeletedCoursesTable initialCourses={courses} token={token} />
    </div>
  );
}
