import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { listGroups } from '@/src/features/groups/service';
import InviteForm from './InviteForm';

// Server Component — resolves the calling Admin's auth token and groups list,
// then passes them to the interactive InviteForm Client Component.
export default async function InvitePage() {
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

  if (!tenantId || role !== 'ADMIN') redirect('/');

  const groups = await listGroups(tenantId);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="mb-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Invite a new member
        </h1>
        <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
          An email will be sent with a link to complete registration. Role and group are set now and cannot be changed by the registrant.
        </p>
        <InviteForm token={token} groups={groups ?? []} />
      </div>
    </main>
  );
}
