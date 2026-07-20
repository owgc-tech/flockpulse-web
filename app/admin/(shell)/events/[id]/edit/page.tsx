import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/src/lib/supabase/server';
import { getEventById } from '@/src/features/events/service';
import { listEventTypes } from '@/src/features/event-types/event-type.service';
import { listGroups } from '@/src/features/groups/service';
import { listMembers } from '@/src/features/members/service';
import type { EventDetailRow } from '@/src/features/events/event.types';
import { isAdminTier, isLeaderTierOrAbove, type Role } from '@/src/lib/auth/middleware';
import EventForm from '../../EventForm';

export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect('/login');

  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  const role = user.app_metadata?.role as Role | undefined;
  const memberId = user.app_metadata?.member_id as string | undefined;
  const token = (await supabase.auth.getSession()).data.session?.access_token;

  if (!tenantId || !role || !isLeaderTierOrAbove(role) || !memberId || !token) redirect('/login');

  let event: EventDetailRow;
  try {
    event = await getEventById(id, tenantId) as unknown as EventDetailRow;
  } catch {
    redirect('/admin/events');
  }

  // DIP-FP-114-web: Leader-tier may only reach the edit page for events they own —
  // same ownership rule the PATCH API enforces, checked here too so a direct URL
  // visit doesn't render a form that will just 403 on submit.
  // FP-161-2: gated on owner_member_id (transferable), not created_by_member_id
  // (permanent audit history only, no longer read for permission checks).
  if (!isAdminTier(role) && event.owner_member_id !== memberId) {
    redirect(`/admin/events/${id}`);
  }

  const [eventTypes, groups, members] = await Promise.all([
    listEventTypes(tenantId),
    listGroups(tenantId),
    listMembers(tenantId),
  ]);

  return (
    <div className="px-6 py-8">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Edit event</h1>
        </div>
        <EventForm token={token} eventTypes={eventTypes} groups={groups ?? []} members={members ?? []} initialEvent={event} isAdmin={isAdminTier(role)} />
      </div>
    </div>
  );
}
