import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/src/lib/supabase/server';
import { getEventById, listMeetingResources } from '@/src/features/events/service';
import { listEventTypes } from '@/src/features/event-types/event-type.service';
import { listGroups } from '@/src/features/groups/service';
import { listMembers } from '@/src/features/members/service';
import type { EventDetailRow } from '@/src/features/events/event.types';
import { isAdminTier, isLeaderTierOrAbove, type Role } from '@/src/lib/auth/middleware';
import EventDetail from './EventDetail';

export default async function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect('/login');

  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  const role = user.app_metadata?.role as Role | undefined;
  const memberId = user.app_metadata?.member_id as string | undefined;
  const token = (await supabase.auth.getSession()).data.session?.access_token;

  // DIP-FP-114-web: readable by Leader-tier; mutation controls inside EventDetail
  // are gated by ownership (canManage = Admin-tier OR event.created_by_member_id === memberId).
  if (!tenantId || !role || !isLeaderTierOrAbove(role) || !memberId || !token) redirect('/login');

  let event: EventDetailRow;
  try {
    event = await getEventById(id, tenantId) as unknown as EventDetailRow;
  } catch {
    redirect('/admin/events');
  }

  const [eventTypes, groups, members, meetingResources] = await Promise.all([
    listEventTypes(tenantId),
    listGroups(tenantId),
    listMembers(tenantId),
    listMeetingResources(tenantId),
  ]);

  const canManage = isAdminTier(role) || event.created_by_member_id === memberId;

  return (
    <div className="px-6 py-8">
      <div className="mx-auto max-w-3xl">
        <EventDetail event={event} eventTypes={eventTypes} groups={groups ?? []} members={members ?? []} meetingResources={meetingResources} token={token} canManage={canManage} />
      </div>
    </div>
  );
}
