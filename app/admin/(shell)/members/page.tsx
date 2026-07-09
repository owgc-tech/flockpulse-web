import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/src/lib/supabase/server';
import { listMembers } from '@/src/features/members/service';
import type { MemberRow } from '@/src/features/members/member.types';
import MembersTable from './MembersTable';

// Server Component — resolves auth, fetches members (including deactivated, so the List can
// show status), then passes them to the interactive MembersTable Client Component. Route is
// protected by proxy.ts (session + MFA trust).
export default async function MembersPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect('/login');

  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  const role = user.app_metadata?.role as string | undefined;
  const token = (await supabase.auth.getSession()).data.session?.access_token;

  if (!tenantId || role !== 'ADMIN' || !token) redirect('/login');

  const members = await listMembers(tenantId, true);

  return (
    <div className="px-6 py-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Members</h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              All members of this organisation.
            </p>
          </div>
          <a
            href="/admin/invite"
            className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Add Member
          </a>
        </div>
        <MembersTable members={members as unknown as MemberRow[]} />
      </div>
    </div>
  );
}
