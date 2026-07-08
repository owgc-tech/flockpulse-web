import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/src/lib/supabase/server';
import { getTenantSettings } from '@/src/features/tenant/service';
import AdminSidebar from '@/src/components/admin/AdminSidebar';
import CommunityBanner from '@/src/components/admin/CommunityBanner';

export default async function AdminShellLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect('/login');

  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  const role = user.app_metadata?.role as string | undefined;

  if (!tenantId || role !== 'ADMIN') redirect('/login');

  let settings: { name: string; logo_url: string | null; tagline: string | null } | null = null;
  try {
    settings = await getTenantSettings(tenantId);
  } catch {
    // Non-fatal: banner renders with fallbacks
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-zinc-50 dark:bg-black">
      <CommunityBanner
        name={settings?.name ?? null}
        logoUrl={settings?.logo_url ?? null}
        tagline={settings?.tagline ?? null}
      />
      <div className="flex flex-1 overflow-hidden">
        <AdminSidebar />
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
