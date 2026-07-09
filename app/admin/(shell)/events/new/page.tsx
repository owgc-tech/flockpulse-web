import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/src/lib/supabase/server';
import { listEventTypes } from '@/src/features/event-types/event-type.service';
import { listGroups } from '@/src/features/groups/service';
import { listMembers } from '@/src/features/members/service';
import EventForm from '../EventForm';

export default async function CreateEventPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect('/login');

  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  const role = user.app_metadata?.role as string | undefined;
  const token = (await supabase.auth.getSession()).data.session?.access_token;

  if (!tenantId || role !== 'ADMIN' || !token) redirect('/login');

  const [eventTypes, groups, members] = await Promise.all([
    listEventTypes(tenantId),
    listGroups(tenantId),
    listMembers(tenantId),
  ]);

  return (
    <div className="px-6 py-8">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Create event</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            New events are created as drafts and don&apos;t target anyone until published.
          </p>
        </div>
        <EventForm token={token} eventTypes={eventTypes} groups={groups ?? []} members={members ?? []} />
      </div>
    </div>
  );
}
