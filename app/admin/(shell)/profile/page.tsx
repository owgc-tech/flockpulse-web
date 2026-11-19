import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/src/lib/supabase/server';
import { getMyProfile } from '@/src/features/members/service';
import { isLeaderTierOrAbove, type Role } from '@/src/lib/auth/middleware';
import ProfileForm from './ProfileForm';
import ChangePasswordForm from './ChangePasswordForm';

// FP-135: under app/admin/(shell) — inherits the shell's sidebar/banner chrome
// and outer auth gate, matching every other admin page (Community, Reports,
// Audit Logs). Reached via the avatar popover's "View and Edit Profile" link.
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
    <div className="px-6 py-8">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8">
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">My Profile</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            View and edit your personal details.
          </p>
        </div>
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

        <div className="mt-10 border-t border-zinc-200 pt-8 dark:border-zinc-800">
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Change password</h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Update the password you use to log in. No need to enter your current password.
            </p>
          </div>
          <ChangePasswordForm />
        </div>
      </div>
    </div>
  );
}
