import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/src/lib/supabase/server';
import { listInvitations } from '@/src/features/invitations/invitation.service';
import InvitationsTable from './InvitationsTable';

// Server Component — resolves auth, fetches invitations with resolved names,
// then passes them to the interactive InvitationsTable Client Component.
// Route is protected by proxy.ts (session + MFA trust).
export default async function InvitationsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect('/login');

  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  const role = user.app_metadata?.role as string | undefined;
  const memberId = user.app_metadata?.member_id as string | undefined;
  const token = (await supabase.auth.getSession()).data.session?.access_token;

  if (!tenantId || role !== 'ADMIN' || !memberId || !token) redirect('/login');

  const invitations = await listInvitations(tenantId);

  const { data: tenantData } = await supabase.from('tenants').select('name').eq('id', tenantId).single();
  const tenantName = tenantData?.name ?? undefined;

  return (
    <div className="px-6 py-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Invitations</h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              All invitations sent for this organisation.
            </p>
          </div>
          <a
            href="/admin/invite"
            className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Send invite
          </a>
        </div>
        <InvitationsTable initialInvitations={invitations} token={token} tenantName={tenantName} />
      </div>
    </div>
  );
}
