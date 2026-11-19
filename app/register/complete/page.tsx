import CompleteProfileForm from './CompleteProfileForm';

export default function CompleteRegistrationPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="mb-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Complete your profile
        </h1>
        <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
          Your role has already been set by your organisation&apos;s admin. Fill in your details below to finish setting up your account.
        </p>
        <CompleteProfileForm />
      </div>
    </main>
  );
}
