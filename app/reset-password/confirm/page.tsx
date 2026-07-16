import { createSupabaseServerClient } from '@/src/lib/supabase/server';
import ResetConfirmForm from './ResetConfirmForm';

// DIP-FP-108: Supabase's password-recovery email uses the PKCE query-param
// format (?code=...), not the old implicit-flow URL hash. Exchanging the
// code here establishes the session server-side via cookies (through the
// same @supabase/ssr client every other authenticated server action already
// relies on) — the form itself no longer needs to parse or thread a token.
export default async function ResetConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;

  let exchangeError: string | null = null;

  if (!code) {
    exchangeError = 'Invalid reset link. Please request a new one.';
  } else {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      exchangeError = 'Reset link is invalid or expired. Please request a new one.';
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="mb-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">Set new password</h1>
        <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
          Choose a new password for your account. After updating, you&apos;ll be asked to verify with your authenticator app.
        </p>
        {exchangeError ? (
          <div className="flex flex-col gap-4">
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
              {exchangeError}
            </div>
            <a href="/reset-password" className="text-center text-sm underline text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
              Request a new reset link
            </a>
          </div>
        ) : (
          <ResetConfirmForm />
        )}
      </div>
    </main>
  );
}
