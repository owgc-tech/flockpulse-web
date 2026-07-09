import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/src/lib/supabase/server';
import { getEventById } from '@/src/features/events/service';
import { listEventTypes } from '@/src/features/event-types/event-type.service';
import { listGroups } from '@/src/features/groups/service';
import type { EventDetailRow } from '@/src/features/events/event.types';
import EventDetail from './EventDetail';

export default async function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect('/login');

  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  const role = user.app_metadata?.role as string | undefined;
  const token = (await supabase.auth.getSession()).data.session?.access_token;

  if (!tenantId || role !== 'ADMIN' || !token) redirect('/login');

  let event: EventDetailRow;
  try {
    event = await getEventById(id, tenantId) as unknown as EventDetailRow;
  } catch {
    redirect('/admin/events');
  }

  const [eventTypes, groups] = await Promise.all([
    listEventTypes(tenantId),
    listGroups(tenantId),
  ]);

  return (
    <div className="px-6 py-8">
      <div className="mx-auto max-w-3xl">
        <EventDetail event={event} eventTypes={eventTypes} groups={groups ?? []} token={token} />
      </div>
    </div>
  );
}
