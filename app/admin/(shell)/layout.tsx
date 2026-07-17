import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/src/lib/supabase/server';
import { getTenantSettings } from '@/src/features/tenant/service';
import { getMyProfile } from '@/src/features/members/service';
import AdminSidebar from '@/src/components/admin/AdminSidebar';
import CommunityBanner from '@/src/components/admin/CommunityBanner';
import UserAvatarMenu from '@/src/components/admin/UserAvatarMenu';
import { isLeaderTierOrAbove, type Role } from '@/src/lib/auth/middleware';

export default async function AdminShellLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect('/login');

  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  const memberId = user.app_metadata?.member_id as string | undefined;
  const role = user.app_metadata?.role as Role | undefined;

  // DIP-FP-114-web: rank-based (Admin-tier or Leader-tier) — this is the outer
  // "can reach the shell at all" gate. Per-section exclusion (Formation/Groups/
  // Members/Restore) happens one level down, in each page's own guard.
  if (!tenantId || !role || !isLeaderTierOrAbove(role)) redirect('/login');

  let settings: { name: string; logo_url: string | null; tagline: string | null } | null = null;
  try {
    settings = await getTenantSettings(tenantId);
  } catch {
    // Non-fatal: banner renders with fallbacks
  }

  let profile: Awaited<ReturnType<typeof getMyProfile>> | null = null;
  try {
    if (memberId) profile = await getMyProfile(memberId, tenantId);
  } catch {
    // Non-fatal: avatar renders with fallbacks
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-zinc-50 dark:bg-black">
      <div className="relative">
        <CommunityBanner
          name={settings?.name ?? null}
          logoUrl={settings?.logo_url ?? null}
          tagline={settings?.tagline ?? null}
        />
        <div className="absolute right-6 top-1/2 z-30 -translate-y-1/2">
          <UserAvatarMenu
            firstName={profile?.first_name ?? null}
            lastName={profile?.last_name ?? null}
            role={role}
            groups={profile?.groups ?? []}
          />
        </div>
      </div>
      <div className="flex flex-1 overflow-hidden">
        <AdminSidebar role={role} />
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
