import ResetConfirmForm from './ResetConfirmForm';

export default function ResetConfirmPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="mb-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">Set new password</h1>
        <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
          Choose a new password for your account. After updating, you'll be asked to verify with your authenticator app.
        </p>
        <ResetConfirmForm />
      </div>
    </main>
  );
}
