import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/src/lib/supabase/server';
import { listGroups } from '@/src/features/groups/service';
import { isAdminTier, type Role } from '@/src/lib/auth/middleware';
import InviteForm from './InviteForm';

// Server Component — resolves the calling Admin's auth token and groups list,
// then passes them to the interactive InviteForm Client Component.
// Route is protected by proxy.ts (session + MFA trust) — this page only
// needs to read claims and fetch the groups list.
export default async function InvitePage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect('/login');

  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  const role = user.app_metadata?.role as Role | undefined;
  const token = (await supabase.auth.getSession()).data.session?.access_token;

  // DIP-FP-114-web: sending invitations stays Admin-tier-only, excluded for
  // Leader-tier — isAdminTier() also fixes the FP-113 Admin-tier-synonym gap
  // the old literal `role !== 'ADMIN'` check had (SR_COORDINATOR/COORDINATOR/
  // COMMUNITY_SERVANT would have been incorrectly blocked here too).
  if (!tenantId || !role || !isAdminTier(role) || !token) redirect('/login');

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
