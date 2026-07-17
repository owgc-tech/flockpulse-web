import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/src/lib/supabase/server';
import { getMyProfile } from '@/src/features/members/service';
import { isLeaderTierOrAbove, type Role } from '@/src/lib/auth/middleware';
import ProfileForm from './ProfileForm';

// FP-135: standalone route (not under app/admin/(shell)) — reached via the
// avatar popover's "View and Edit Profile" link, so it does its own auth
// check the same way app/admin/mfa-enroll/page.tsx does.
export default async function ProfilePage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect('/login');

  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  const memberId = user.app_metadata?.member_id as string | undefined;
  const role = user.app_metadata?.role as Role | undefined;
  const token = (await supabase.auth.getSession()).data.session?.access_token;

  if (!tenantId || !memberId || !role || !isLeaderTierOrAbove(role) || !token) redirect('/login');

  const profile = await getMyProfile(memberId, tenantId);

  return (
    <main className="flex min-h-screen flex-col items-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <div className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="mb-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">My Profile</h1>
        <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
          View and edit your personal details.
        </p>
        <ProfileForm
          token={token}
          email={profile.email}
          initialFirstName={profile.first_name}
          initialLastName={profile.last_name}
          initialGender={profile.gender}
          initialMaritalStatus={profile.marital_status}
          initialBirthdate={profile.birthdate}
          groups={profile.groups}
        />
      </div>
    </main>
  );
}
