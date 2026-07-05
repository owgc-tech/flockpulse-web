'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';

type PageState = 'idle' | 'submitting' | 'check-inbox' | 'error';

function supabaseBrowserClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export default function FounderRegistrationForm() {
  const router = useRouter();
  const [pageState, setPageState] = useState<PageState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setPageState('submitting');

    const db = supabaseBrowserClient();
    const { data, error: signUpError } = await db.auth.signUp({ email, password });

    if (signUpError) {
      setError(signUpError.message);
      setPageState('error');
      return;
    }

    if (data.session) {
      // enable_confirmations = false (local dev): session returned immediately.
      // Store the access token so Screen 2 can pick it up without re-parsing a hash.
      sessionStorage.setItem('fp_founder_token', data.session.access_token);
      router.push('/register/founder/complete');
    } else {
      // enable_confirmations = true (fpdb-dev / production): email confirmation sent.
      // The confirmation link delivers tokens via URL hash to /register/founder/complete.
      setPageState('check-inbox');
    }
  }

  if (pageState === 'check-inbox') {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200">
          <p className="font-medium">Check your inbox</p>
          <p className="mt-1">
            We sent a confirmation link to <strong>{email}</strong>. Click it to continue setting up your community.
          </p>
        </div>
        <p className="text-center text-xs text-zinc-400 dark:text-zinc-600">
          Wrong email?{' '}
          <button
            type="button"
            onClick={() => setPageState('idle')}
            className="underline hover:text-zinc-600 dark:hover:text-zinc-400"
          >
            Go back
          </button>
        </p>
      </div>
    );
  }

  const isSubmitting = pageState === 'submitting';
  const inputClass =
    'rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100';
  const labelClass = 'text-sm font-medium text-zinc-700 dark:text-zinc-300';
  const fieldClass = 'flex flex-col gap-1.5';

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      <div className={fieldClass}>
        <label htmlFor="email" className={labelClass}>Email address</label>
        <input
          id="email" type="email" required
          value={email} onChange={e => setEmail(e.target.value)}
          autoComplete="email"
          className={inputClass}
        />
      </div>

      <div className={fieldClass}>
        <label htmlFor="password" className={labelClass}>Password</label>
        <input
          id="password" type="password" required minLength={8}
          value={password} onChange={e => setPassword(e.target.value)}
          autoComplete="new-password"
          className={inputClass}
        />
      </div>

      <div className={fieldClass}>
        <label htmlFor="confirmPassword" className={labelClass}>Confirm password</label>
        <input
          id="confirmPassword" type="password" required minLength={8}
          value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
          className={inputClass}
        />
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="mt-1 rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {isSubmitting ? 'Creating account…' : 'Continue'}
      </button>

      <p className="text-center text-xs text-zinc-400 dark:text-zinc-600">
        Already have an account?{' '}
        <a href="/login" className="underline hover:text-zinc-600 dark:hover:text-zinc-400">
          Sign in
        </a>
      </p>
    </form>
  );
}
