import LoginForm from './LoginForm';

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="mb-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">Leadership sign in</h1>
        <LoginForm />
      </div>
    </main>
  );
}
