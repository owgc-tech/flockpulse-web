import FounderRegistrationForm from './FounderRegistrationForm';

export default function FounderRegistrationPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <div className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="mb-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Start your community
        </h1>
        <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
          Create your account to get started. You&apos;ll set up your community details on the next step.
        </p>
        <FounderRegistrationForm />
      </div>
    </main>
  );
}
