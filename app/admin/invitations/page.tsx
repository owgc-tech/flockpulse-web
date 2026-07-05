import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { listInvitations } from '@/src/features/invitations/invitation.service';
import InvitationsTable from './InvitationsTable';

// Server Component — resolves auth, fetches invitations with resolved names,
// then passes them to the interactive InvitationsTable Client Component.
export default async function InvitationsPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get('sb-access-token')?.value;
  if (!token) redirect('/login');

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) redirect('/login');

  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  const role = user.app_metadata?.role as string | undefined;
  const memberId = user.app_metadata?.member_id as string | undefined;

  if (!tenantId || role !== 'ADMIN' || !memberId) redirect('/');

  const invitations = await listInvitations(tenantId);

  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-12 dark:bg-black">
      <div className="mx-auto max-w-5xl">
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
        <InvitationsTable initialInvitations={invitations} token={token} />
      </div>
    </main>
  );
}
