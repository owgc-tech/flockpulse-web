import { parseResetCredential } from '@/src/features/auth/reset-password';
import ResetConfirmForm from './ResetConfirmForm';

// FP-265: viewing this page must NOT consume the emailed link. The credential
// (token_hash or code) is only passed to the form, which posts it to
// confirmPasswordResetAction; the action verifies it and sets the password in one
// step (a Server Action can set cookies, a Server Component cannot).
export default async function ResetConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string; code?: string }>;
}) {
  const params = await searchParams;
  const credential = parseResetCredential(params);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="mb-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">Set new password</h1>
        <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
          Choose a new password for your account.
        </p>
        {credential ? (
          <ResetConfirmForm
            tokenHash={credential.kind === 'token_hash' ? credential.tokenHash : undefined}
            code={credential.kind === 'code' ? credential.code : undefined}
          />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
              Invalid reset link. Please request a new one.
            </div>
            <a href="/reset-password" className="text-center text-sm underline text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
              Request a new reset link
            </a>
          </div>
        )}
      </div>
    </main>
  );
}
