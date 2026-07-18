import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/src/lib/supabase/server';
import { listMembers } from '@/src/features/members/service';
import { listGroups } from '@/src/features/groups/service';
import { listEvents } from '@/src/features/events/service';
import { isLeaderTierOrAbove, type Role } from '@/src/lib/auth/middleware';
import RsvpReportBrowser from '../RsvpReportBrowser';

export default async function RsvpReportPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect('/login');

  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  const role = user.app_metadata?.role as Role | undefined;
  const token = (await supabase.auth.getSession()).data.session?.access_token;

  // STORY-9.1: read-accessible to Leader-tier — RBAC scoping to assigned
  // members happens server-side in report.service.ts, not by hiding the page.
  if (!tenantId || !role || !isLeaderTierOrAbove(role) || !token) redirect('/login');

  const [members, groups, events] = await Promise.all([
    listMembers(tenantId),
    listGroups(tenantId),
    listEvents(tenantId),
  ]);

  const eventOptions = (events ?? []).map((e) => ({ id: e.id, name: e.name, start_datetime: e.start_datetime }));
  const groupOptions = (groups ?? []).map((g) => ({ id: g.id as string, name: g.name as string }));

  return (
    <div className="flex flex-col">
      <div className="border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">RSVP Report</h1>
        <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
          RSVP reporting, filterable by event, group, and member.
        </p>
      </div>

      <div className="p-6">
        <RsvpReportBrowser events={eventOptions} groups={groupOptions} members={members ?? []} token={token} />
      </div>
    </div>
  );
}
