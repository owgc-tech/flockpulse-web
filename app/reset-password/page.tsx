import ResetRequestForm from './ResetRequestForm';

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="mb-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">Reset password</h1>
        <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
          Enter your email and we&apos;ll send you a reset link.
        </p>
        <ResetRequestForm />
      </div>
    </main>
  );
}
