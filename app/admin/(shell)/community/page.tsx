import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/src/lib/supabase/server';
import { getTenantSettings } from '@/src/features/tenant/service';
import CommunitySettingsForm from './CommunitySettingsForm';

export default async function CommunityPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect('/login');

  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  const role = user.app_metadata?.role as string | undefined;
  const token = (await supabase.auth.getSession()).data.session?.access_token;

  if (!tenantId || role !== 'ADMIN' || !token) redirect('/login');

  const settings = await getTenantSettings(tenantId);

  return (
    <div className="px-6 py-8">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8">
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Community Settings</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Manage your community's name, logo, tagline, and description.
          </p>
        </div>
        <CommunitySettingsForm
          token={token}
          communityName={settings.name}
          initialLogoUrl={settings.logo_url ?? null}
          initialTagline={settings.tagline ?? null}
          initialDescription={settings.description ?? null}
        />
      </div>
    </div>
  );
}
