import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/src/lib/supabase/server';
import { listEvents } from '@/src/features/events/service';
import { listEventTypes } from '@/src/features/event-types/event-type.service';
import { listGroups } from '@/src/features/groups/service';
import type { EventListRow } from '@/src/features/events/event.types';
import { isLeaderTierOrAbove, type Role } from '@/src/lib/auth/middleware';
import EventsTable from './EventsTable';

// Server Component — resolves auth, fetches events/event-types/groups, then passes
// them to the interactive EventsTable Client Component. Route is protected by
// proxy.ts (session + MFA trust).
export default async function EventsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect('/login');

  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  const role = user.app_metadata?.role as Role | undefined;
  const token = (await supabase.auth.getSession()).data.session?.access_token;

  // DIP-FP-114-web: Events is read-accessible to Leader-tier (own-created events
  // remain mutable — enforced by the API layer and reflected in EventDetail's UI).
  if (!tenantId || !role || !isLeaderTierOrAbove(role) || !token) redirect('/login');

  const [events, eventTypes, groups] = await Promise.all([
    listEvents(tenantId),
    listEventTypes(tenantId),
    listGroups(tenantId),
  ]);

  return (
    <div className="px-6 py-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Events</h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Create, schedule, and manage events for this organisation.
            </p>
          </div>
          <a
            href="/admin/events/new"
            className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Create event
          </a>
        </div>
        <EventsTable
          events={events as unknown as EventListRow[]}
          eventTypes={eventTypes}
          groups={groups ?? []}
        />
      </div>
    </div>
  );
}
