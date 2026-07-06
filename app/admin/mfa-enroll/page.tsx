import { createSupabaseServerClient } from '@/src/lib/supabase/server';
import { redirect } from 'next/navigation';
import MFAEnrollForm from './MFAEnrollForm';

// This page is NOT behind the proxy's MFA-trust check — it's the enrollment
// destination. It does require a valid password-authenticated session (aal1+).
export default async function MFAEnrollPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const role = user.app_metadata?.role as string | undefined;
  if (role !== 'ADMIN') redirect('/login');

  // If they already have a verified factor, skip enrollment.
  const { data: factorData } = await supabase.auth.mfa.listFactors();
  const hasVerifiedFactor = factorData?.totp?.some(f => f.status === 'verified') ?? false;
  if (hasVerifiedFactor) redirect('/login/mfa-challenge');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="mb-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Set up two-factor authentication
        </h1>
        <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
          Two-factor authentication is required for all Admin accounts. You only need to do this once.
        </p>
        <MFAEnrollForm />
      </div>
    </main>
  );
}
