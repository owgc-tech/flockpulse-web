import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/src/lib/supabase/server';
import { listEventTypesWithUsageCounts } from '@/src/features/event-types/event-type.service';
import { isAdminTier, type Role } from '@/src/lib/auth/middleware';
import EventTypesTable from './EventTypesTable';

// Server Component — resolves auth, fetches event types (including archived, so
// the table can show status + usage count), then passes them to the interactive
// EventTypesTable Client Component. Route is protected by proxy.ts (session + MFA
// trust). Admin-tier-only, matching Groups' page (DIP-FP-114-web precedent).
export default async function EventTypesPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect('/login');

  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  const role = user.app_metadata?.role as Role | undefined;
  const token = (await supabase.auth.getSession()).data.session?.access_token;

  if (!tenantId || !role || !isAdminTier(role) || !token) redirect('/login');

  const eventTypes = await listEventTypesWithUsageCounts(tenantId);

  return (
    <div className="px-6 py-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Event Types</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Event types available when creating or editing events in this organisation.
          </p>
        </div>
        <EventTypesTable initialEventTypes={eventTypes} token={token} />
      </div>
    </div>
  );
}
