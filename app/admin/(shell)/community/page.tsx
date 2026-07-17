import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/src/lib/supabase/server';
import { getTenantSettings } from '@/src/features/tenant/service';
import { isAdminTier, isLeaderTierOrAbove, type Role } from '@/src/lib/auth/middleware';
import CommunitySettingsForm from './CommunitySettingsForm';

export default async function CommunityPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect('/login');

  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  const role = user.app_metadata?.role as Role | undefined;
  const token = (await supabase.auth.getSession()).data.session?.access_token;

  // DIP-FP-114-web: read-accessible to Leader-tier; editing stays Admin-tier-only
  // (canEdit hides the logo-upload/details-save forms; updateCommunityDetailsAction/
  // uploadLogoAction already independently reject non-Admin-tier callers).
  if (!tenantId || !role || !isLeaderTierOrAbove(role) || !token) redirect('/login');

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
          initialAttendanceWindowHours={settings.attendance_window_hours}
          initialRsvpClosureDaysDefault={settings.rsvp_closure_days_default}
          initialRsvpNudgeDays1={settings.rsvp_nudge_days_1}
          initialRsvpNudgeDays2={settings.rsvp_nudge_days_2}
          initialRsvpNudgeDays3={settings.rsvp_nudge_days_3}
          canEdit={isAdminTier(role)}
        />
      </div>
    </div>
  );
}
