// FP-265: shown after a successful password reset. No Supabase call, no personal data,
// no auth required. `for` only picks the wording (Members use the phone app).
export default async function ResetDonePage({
  searchParams,
}: {
  searchParams: Promise<{ for?: string }>;
}) {
  const { for: variant } = await searchParams;

  const message =
    variant === 'member'
      ? 'Return to the FlockPulse app and sign in with your new password.'
      : variant === 'leader'
        ? 'Sign in again to continue. You will be asked for your authenticator code.'
        : 'Sign in with your new password in the FlockPulse app, or on the website.';

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="mb-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">Password updated</h1>
        <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">{message}</p>
        {variant !== 'member' && (
          <a href="/login" className="block text-center text-sm underline text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
            Go to sign in
          </a>
        )}
      </div>
    </main>
  );
}
