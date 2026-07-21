import { createSupabaseServerClient } from '@/src/lib/supabase/server';
import { redirect } from 'next/navigation';
import { isLeaderTierOrAbove, type Role } from '@/src/lib/auth/middleware';
import MFAChallengeForm from './MFAChallengeForm';

export default async function MFAChallengePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  // DIP-FP-114-web: rank-based — Leader-tier must also pass through MFA
  // challenge to reach the admin shell, same as Admin-tier.
  const role = user.app_metadata?.role as Role | undefined;
  if (!role || !isLeaderTierOrAbove(role)) redirect('/login');

  const { next = '/admin/events' } = await searchParams;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="mb-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Two-factor verification
        </h1>
        <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
          Enter the 6-digit code from your authenticator app.
        </p>
        <MFAChallengeForm next={next} />
      </div>
    </main>
  );
}
