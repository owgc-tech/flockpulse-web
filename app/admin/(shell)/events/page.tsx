import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/src/lib/supabase/server';
import { listEvents } from '@/src/features/events/service';
import { listEventTypes } from '@/src/features/event-types/event-type.service';
import { listGroups } from '@/src/features/groups/service';
import { isLeaderTierOrAbove, type Role } from '@/src/lib/auth/middleware';
import EventsTable from './EventsTable';

const PAGE_SIZE = 20;

// Server Component — resolves auth, fetches the first page of events (already
// filtered per the URL's own query params, so a bookmarked/shared filtered URL
// doesn't flash unfiltered content before the client takes over) plus
// event-types/groups, then passes everything to the interactive EventsTable
// Client Component. Route is protected by proxy.ts (session + MFA trust).
export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ eventTypeIds?: string; month?: string; status?: string }>;
}) {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect('/login');

  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  const role = user.app_metadata?.role as Role | undefined;
  const token = (await supabase.auth.getSession()).data.session?.access_token;

  // DIP-FP-114-web: Events is read-accessible to Leader-tier (own-created events
  // remain mutable — enforced by the API layer and reflected in EventDetail's UI).
  if (!tenantId || !role || !isLeaderTierOrAbove(role) || !token) redirect('/login');

  const { eventTypeIds, month, status } = await searchParams;
  const initialFilters = {
    eventTypeIds: eventTypeIds ? eventTypeIds.split(',').filter(Boolean) : [],
    month: month ?? '',
    status: status ? status.split(',').filter(Boolean) : [],
  };

  const [eventsResult, eventTypes, groups] = await Promise.all([
    listEvents(tenantId, {
      limit: PAGE_SIZE,
      offset: 0,
      eventTypeIds: initialFilters.eventTypeIds.length > 0 ? initialFilters.eventTypeIds : undefined,
      month: initialFilters.month || undefined,
      status: initialFilters.status.length > 0 ? initialFilters.status : undefined,
    }),
    listEventTypes(tenantId),
    listGroups(tenantId),
  ]);

  return (
    <EventsTable
      token={token}
      initialEvents={eventsResult.data}
      initialHasMore={eventsResult.hasMore}
      initialFilters={initialFilters}
      eventTypes={eventTypes}
      groups={groups ?? []}
      pageSize={PAGE_SIZE}
    />
  );
}
